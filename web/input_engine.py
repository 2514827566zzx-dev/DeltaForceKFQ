"""Monotonic, interruptible single-voice keyboard/mouse score scheduler."""
import math
import threading
import time

SCALE = (0, 2, 4, 5, 7, 9, 11, 12)
KEYS = 'ZXCVBNM,'
SPEEDS = (0.5, 0.8, 1, 1.2, 1.5, 2)


def map_pitch(pitch):
    """C4=Z. One held left/right button is exactly one octave, never two."""
    folded = pitch
    while folded < 48:
        folded += 12
    while folded > 85:
        folded -= 12
    options = []
    for octave in (0, -1, 1):
        for index, semi in enumerate(SCALE):
            for sharp in (False, True):
                if 60 + octave * 12 + semi + int(sharp) == folded:
                    options.append((abs(octave) * 3 + int(sharp), index, octave, sharp))
    if not options:
        raise ValueError('音符无法映射')
    _, index, octave, sharp = min(options)
    return dict(key=KEYS[index], octave=octave, sharp=sharp)


def number(value, name, lo, hi):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lo <= value <= hi:
        raise ValueError(name + '无效')
    return float(value)


def prepare_score(score):
    duration = number(score.get('duration'), '曲目时长', 0.01, 3600)
    source = score.get('notes')
    if not isinstance(source, list) or not 1 <= len(source) <= 100000:
        raise ValueError('曲谱音符数无效')
    actions = []
    for note in source:
        if not isinstance(note, dict):
            raise ValueError('音符无效')
        start = number(note.get('time'), '音符起点', 0, duration)
        length = number(note.get('duration'), '音符时长', 0.001, 3600)
        pitch = number(note.get('pitch'), '音高', 0, 127)
        if pitch != int(pitch):
            raise ValueError('音高必须为整数')
        if start >= duration:
            raise ValueError('音符必须在曲目结束前开始')
        explicit = note.get('input')
        if explicit is not None:
            if not isinstance(explicit, dict) or explicit.get('key') not in list(KEYS) or type(explicit.get('octave')) is not int or explicit['octave'] not in (-1, 0, 1) or type(explicit.get('sharp')) is not bool:
                raise ValueError('TXT 键位仅支持一个八度修饰和半音修饰')
            action = dict(explicit)
        else:
            action = map_pitch(int(pitch))
        actions.append(dict(action, time=start, end=min(duration, start + length), pitch=pitch))
    # The harmonica is monophonic. Keep the highest simultaneous note, and
    # release the preceding note before a different set of modifiers is pressed.
    by_time = {}
    for action in actions:
        old = by_time.get(action['time'])
        if old is None or action['pitch'] > old['pitch']:
            by_time[action['time']] = action
    actions = sorted(by_time.values(), key=lambda a: a['time'])
    for index, action in enumerate(actions[:-1]):
        gap = min(0.012, (actions[index + 1]['time'] - action['time']) / 4)
        action['end'] = min(action['end'], actions[index + 1]['time'] - gap)
    return actions, duration


class InputEngine:
    def __init__(self, bridge, expected_target=None):
        self.bridge = bridge
        self.expected_target = expected_target
        self.cv = threading.Condition(threading.RLock())
        self.actions = []
        self.duration = 0
        self.position = 0
        self.anchor = time.monotonic()
        self.speed = 1
        self.state = 'idle'
        self.owner = ''
        self.song_id = ''
        self.error = ''
        self.target = ''
        self.native = dict(ready=False, keys=[], buttons=[], hotkeys=[])
        self.index = 0
        self.active = None
        self.emitted = 0
        self.serial = 0
        self.closed = False
        self.worker = threading.Thread(target=self.run, daemon=True, name='Harmonica-input')
        self.worker.start()

    def now(self):
        if self.state == 'playing':
            return min(self.duration, self.position + (time.monotonic() - self.anchor) * self.speed)
        return self.position

    def release(self):
        self.bridge.release()
        self.native['keys'] = []; self.native['buttons'] = []
        self.active = None

    def stop(self):
        with self.cv:
            self.state = 'idle'; self.position = 0
            try:
                self.release()
            except Exception as exc:
                self.error = str(exc)
            self.cv.notify_all()

    def load(self, score, song_id, owner, speed):
        actions, duration = prepare_score(score)
        if speed not in SPEEDS:
            raise ValueError('不支持的速度')
        with self.cv:
            self.stop()
            self.actions, self.duration = actions, duration
            self.speed = speed; self.song_id = str(song_id)[:200]; self.owner = owner
            self.error = ''; self.emitted = 0

    def play(self, delay=3):
        with self.cv:
            if not self.actions:
                raise ValueError('请先选择曲目')
            if not self.native.get('ready'):
                raise RuntimeError('请在系统设置 → 隐私与安全性 → 辅助功能中允许“口风琴输入助手”，然后重试。')
            if self.state in ('playing', 'countdown'):
                return
            if self.position >= self.duration:
                self.position = 0
            self.error = ''; self.state = 'countdown'; self.deadline = time.monotonic() + delay
            self.cv.notify_all()

    def begin(self):
        result = self.bridge.arm()
        if self.expected_target and result.get('target') != self.expected_target:
            self.release()
            raise RuntimeError('测试接收应用应为 %s，当前是 %s；未发送任何按键。' % (self.expected_target, result.get('target', '未知')))
        self.target = result.get('target', '')
        self.index = 0
        while self.index < len(self.actions) and self.actions[self.index]['end'] <= self.position:
            self.index += 1
        self.anchor = time.monotonic(); self.state = 'playing'

    def pause(self):
        with self.cv:
            self.position = self.now(); self.state = 'paused'
            self.release(); self.cv.notify_all()

    def seek(self, position):
        with self.cv:
            position = number(position, '进度', 0, self.duration)
            # Seeking from a control page pauses instead of emitting into that page.
            self.pause(); self.position = position

    def set_speed(self, speed):
        if speed not in SPEEDS:
            raise ValueError('不支持的速度')
        with self.cv:
            self.position = self.now(); self.anchor = time.monotonic(); self.speed = speed
            self.cv.notify_all()

    def snapshot(self):
        with self.cv:
            self.serial += 1
            return dict(sequence=self.serial, state=self.state, position=self.now(), duration=self.duration, speed=self.speed,
                        songId=self.song_id, owner=self.owner, error=self.error, target=self.target,
                        ready=self.native.get('ready', False), heldKeys=self.native.get('keys', []),
                        heldButtons=self.native.get('buttons', []), emittedNotes=self.emitted,
                        countdown=max(0, self.deadline - time.monotonic()) if self.state == 'countdown' else 0)

    def note_on(self, action):
        if action['octave']:
            self.bridge.mouse(0 if action['octave'] < 0 else 2, True)
        if action['sharp']:
            self.bridge.mouse(1, True)
        self.bridge.key(action['key'], True)
        self.active = action; self.emitted += 1

    def note_off(self):
        if self.active:
            a = self.active
            self.bridge.key(a['key'], False)
            if a['sharp']:
                self.bridge.mouse(1, False)
            if a['octave']:
                self.bridge.mouse(0 if a['octave'] < 0 else 2, False)
            self.active = None

    def run(self):
        last_status = 0
        while not self.closed:
            with self.cv:
                try:
                    if time.monotonic() - last_status >= 0.04:
                        self.native = self.bridge.status(); last_status = time.monotonic()
                        for action in self.native.get('hotkeys', []):
                            if action == 'stop': self.stop()
                            elif action == 'toggle' and self.actions:
                                if self.state in ('playing', 'countdown'): self.pause()
                                else: self.play(delay=0.2)
                        if self.state == 'playing' and not self.native.get('targetActive', True):
                            self.pause(); self.error = '接收应用已切换，演奏已暂停。'
                    if self.state == 'countdown' and time.monotonic() >= self.deadline:
                        self.begin()
                    if self.state == 'playing':
                        pos = self.now()
                        if self.active and pos >= self.active['end']:
                            self.note_off()
                        while self.index < len(self.actions) and self.actions[self.index]['end'] <= pos:
                            self.index += 1
                        if self.active is None and self.index < len(self.actions) and self.actions[self.index]['time'] <= pos:
                            self.note_on(self.actions[self.index]); self.index += 1
                        if pos >= self.duration:
                            self.stop()
                except Exception as exc:
                    self.state = 'idle'; self.position = 0; self.error = str(exc)
                    try: self.release()
                    except Exception: pass
                    last_status = time.monotonic()
                self.cv.wait(0.005 if self.state == 'playing' else 0.04)

    def close(self):
        with self.cv:
            self.closed = True; self.stop(); self.cv.notify_all()
        self.worker.join(timeout=3)
