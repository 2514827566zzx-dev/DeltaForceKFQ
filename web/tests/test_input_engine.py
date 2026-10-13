import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from input_engine import InputEngine, map_pitch, prepare_score


class FakeBridge:
    """Test-only recording sink. Production has no simulated-input switch."""
    def __init__(self):
        self.events = []; self.keys = set(); self.buttons = set()
        self.hotkeys = []; self.target_active = True; self.ready = True
        self.fail_key = False

    def status(self):
        actions, self.hotkeys = self.hotkeys, []
        return dict(ready=self.ready, keys=list(self.keys), buttons=list(self.buttons), hotkeys=actions, targetActive=self.target_active)

    def arm(self):
        return dict(target='test')

    def key(self, key, down):
        if self.fail_key and down: raise RuntimeError('injected failure')
        self.events.append(('key', key, down, time.monotonic()))
        self.keys.add(key) if down else self.keys.discard(key)

    def mouse(self, button, down):
        self.events.append(('mouse', button, down, time.monotonic()))
        self.buttons.add(button) if down else self.buttons.discard(button)

    def release(self):
        for key in list(self.keys): self.key(key, False)
        for button in list(self.buttons): self.mouse(button, False)


def wait_for(condition, timeout=1):
    end = time.monotonic() + timeout
    while not condition():
        if time.monotonic() > end: raise AssertionError('condition timed out')
        time.sleep(0.005)


def score(notes, duration=1):
    return dict(duration=duration, notes=[dict(time=t, duration=d, pitch=p) for t, d, p in notes])


class MappingTests(unittest.TestCase):
    def test_all_38_playable_semitones_roundtrip(self):
        scale = dict(zip('ZXCVBNM,', (0, 2, 4, 5, 7, 9, 11, 12)))
        for pitch in range(48, 86):
            a = map_pitch(pitch)
            self.assertEqual(60 + a['octave'] * 12 + scale[a['key']] + a['sharp'], pitch)
            self.assertIn(a['octave'], (-1, 0, 1))
        self.assertEqual(map_pitch(72), dict(key=',', octave=0, sharp=False))
        self.assertEqual(map_pitch(49), dict(key='Z', octave=-1, sharp=True))
        self.assertEqual(map_pitch(75), dict(key='X', octave=1, sharp=True))

    def test_outside_range_folds_by_whole_octaves(self):
        for pitch in range(128):
            self.assertIn(map_pitch(pitch)['octave'], (-1, 0, 1))

    def test_txt_keeps_explicit_keys_and_rejects_unrepresentable_modifiers(self):
        s = score([(0, .5, 72)])
        s['notes'][0]['input'] = dict(key='Z', octave=1, sharp=False)
        self.assertEqual(prepare_score(s)[0][0]['key'], 'Z')
        s['notes'][0]['input']['octave'] = 2
        with self.assertRaises(ValueError): prepare_score(s)

    def test_invalid_scores_and_overlap(self):
        for value in [float('nan'), float('inf'), -1, True]:
            with self.assertRaises(ValueError): prepare_score(score([(value, .1, 60)]))
        notes, _ = prepare_score(score([(0, 1, 60), (0, 1, 64), (.5, .4, 62)]))
        self.assertEqual(len(notes), 2)
        self.assertEqual(notes[0]['key'], 'C')
        self.assertLess(notes[0]['end'], notes[1]['time'])


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.bridge = FakeBridge(); self.engine = InputEngine(self.bridge)
        wait_for(lambda: self.engine.snapshot()['ready'])

    def tearDown(self):
        self.engine.close()
        self.assertFalse(self.bridge.keys); self.assertFalse(self.bridge.buttons)

    def load(self, s, speed=1):
        self.engine.load(s, 'test', 'client', speed)

    def test_exact_mouse_keyboard_order_and_releases(self):
        self.load(score([(0, .07, 49), (.10, .07, 75), (.20, .07, 72)], .3))
        self.engine.play(0)
        wait_for(lambda: self.engine.emitted == 3 and self.engine.state == 'idle')
        events = [e[:3] for e in self.bridge.events]
        self.assertEqual(events, [
            ('mouse', 0, True), ('mouse', 1, True), ('key', 'Z', True),
            ('key', 'Z', False), ('mouse', 1, False), ('mouse', 0, False),
            ('mouse', 2, True), ('mouse', 1, True), ('key', 'X', True),
            ('key', 'X', False), ('mouse', 1, False), ('mouse', 2, False),
            ('key', ',', True), ('key', ',', False)])

    def test_pause_mid_note_releases_and_resume_continues(self):
        self.load(score([(0, .8, 49)], 1))
        self.engine.play(0); wait_for(lambda: bool(self.bridge.keys))
        self.engine.pause(); pos = self.engine.now()
        self.assertFalse(self.bridge.keys); self.assertFalse(self.bridge.buttons)
        time.sleep(.03); self.assertEqual(self.engine.now(), pos)
        self.engine.play(0); wait_for(lambda: bool(self.bridge.keys))

    def test_stop_cancels_countdown_and_never_sends_note(self):
        self.load(score([(0, .3, 60)])); self.engine.play(.1); self.engine.stop()
        time.sleep(.15); self.assertEqual(self.bridge.events, [])

    def test_change_song_has_no_surviving_old_worker(self):
        self.load(score([(0, .9, 49)])); self.engine.play(0)
        wait_for(lambda: bool(self.bridge.keys))
        self.load(score([(0, .2, 64)], .25)); self.engine.play(0)
        wait_for(lambda: self.engine.emitted == 1 and self.engine.state == 'idle')
        downs = [e[1] for e in self.bridge.events if e[0] == 'key' and e[2]]
        self.assertEqual(downs, ['Z', 'C'])

    def test_double_speed_scales_key_onsets(self):
        self.load(score([(0, .1, 60), (.4, .1, 62)], .6), 2)
        self.engine.play(0); wait_for(lambda: self.engine.emitted == 2)
        downs = [e[3] for e in self.bridge.events if e[0] == 'key' and e[2]]
        self.assertAlmostEqual(downs[1] - downs[0], .2, delta=.04)

    def test_focus_change_pauses_and_failure_releases_partial_chord(self):
        self.load(score([(0, .9, 49)])); self.engine.play(0)
        wait_for(lambda: bool(self.bridge.keys)); self.bridge.target_active = False
        wait_for(lambda: self.engine.state == 'paused')
        self.assertFalse(self.bridge.buttons)
        self.bridge.target_active = True; self.bridge.fail_key = True
        self.engine.play(0); wait_for(lambda: 'injected failure' in self.engine.error)
        self.assertFalse(self.bridge.buttons)

    def test_global_stop_releases_all_inputs(self):
        self.load(score([(0, .9, 75)])); self.engine.play(0)
        wait_for(lambda: bool(self.bridge.keys)); self.bridge.hotkeys.append('stop')
        wait_for(lambda: self.engine.state == 'idle')
        self.assertFalse(self.bridge.keys); self.assertFalse(self.bridge.buttons)

    def test_permission_denial_never_falls_back_to_fake_playback(self):
        self.bridge.ready = False
        wait_for(lambda: not self.engine.snapshot()['ready'])
        self.load(score([(0, .5, 60)]))
        with self.assertRaisesRegex(RuntimeError, '辅助功能'):
            self.engine.play(0)
        self.assertEqual(self.engine.state, 'idle')
        self.assertEqual(self.bridge.events, [])

    def test_wrong_acceptance_target_receives_no_input(self):
        self.engine.expected_target = 'different app'
        self.load(score([(0, .3, 60)])); self.engine.play(0)
        wait_for(lambda: '未发送任何按键' in self.engine.error)
        self.assertEqual(self.bridge.events, [])


if __name__ == '__main__': unittest.main()
