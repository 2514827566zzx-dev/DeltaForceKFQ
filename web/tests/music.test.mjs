import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMidi, parseTxt, pageNumbers } from '../dist/music.js';

const bytes = a => Uint8Array.from(a).buffer;
function midi(track, division = 480) {
  const size = track.length;
  return bytes([77,84,104,100,0,0,0,6,0,0,0,1,division >> 8,division & 255,77,84,114,107,size >>> 24,(size >>> 16) & 255,(size >>> 8) & 255,size & 255,...track]);
}
test('all 663 included MIDI files match their source counts and prepared durations', async () => {
  const songs = JSON.parse(await readFile(new URL('../dist/assets/library.json', import.meta.url)));
  assert.equal(songs.length, 663); assert.equal(new Set(songs.map(s => s.id)).size, 663);
  for (const song of songs) {
    const buffer = await readFile(new URL('../dist/' + song.file, import.meta.url));
    const score = parseMidi(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
    assert.equal(score.notes.length, song.expectedNotes, song.name);
    assert.equal(score.duration, song.duration, song.name);
    assert.ok(score.notes.every(n => Number.isFinite(n.time) && n.duration > 0 && n.pitch >= 0 && n.pitch <= 127));
  }
});
test('tempo changes and running status produce correct timing', () => {
  const score = parseMidi(midi([0,0x90,60,100,0x83,0x60,60,0,0,0xff,0x51,3,0x0f,0x42,0x40,0,0x90,62,100,0x83,0x60,62,0,0,0xff,0x2f,0]));
  assert.equal(score.notes.length, 2);
  assert.equal(score.notes[0].duration, 0.5);
  assert.equal(score.notes[1].time, 0.5);
  assert.equal(score.notes[1].duration, 1);
});
test('SMPTE uses frames instead of tempo ticks', () => {
  const score = parseMidi(midi([0,0x90,60,100,0x87,0x68,0x80,60,0,0,0xff,0x2f,0], 0xe728));
  assert.equal(score.notes[0].duration, 1);
});
test('reject malformed and empty MIDI', () => {
  assert.throws(() => parseMidi(bytes([1, 2, 3])));
  assert.throws(() => parseMidi(midi([0,0xff,0x2f,0])), /音符/);
  assert.throws(() => parseMidi(midi([0,60,90])), /status/);
});
test('TXT preserves mouse modifiers, rests, dotted rhythms and bar padding', () => {
  const score = parseTxt('测试 BPM 120\n小节 1 (4/4)\n键位 Z X+# 0\n节奏 4 8· 8\n小节 2 (4/4)\n键位 C- ,\n节奏 4 4');
  assert.equal(score.notes.length, 4);
  assert.deepEqual(score.notes.map(n => n.pitch), [60, 75, 52, 72]);
  assert.equal(score.notes[1].duration, 0.375);
  assert.equal(score.notes[2].time, 2);
  assert.equal(score.duration, 4);
});
test('bad TXT fails instead of silently importing partial songs', () => {
  assert.throws(() => parseTxt('hello'), /小节/);
  assert.throws(() => parseTxt('小节 1\n键位 Z X\n节奏 4'), /数量/);
  assert.throws(() => parseTxt('小节 1\n键位 Q\n节奏 4'), /键位/);
  assert.throws(() => parseTxt('小节 1\n键位 Z\n节奏 0'), /节奏/);
});
test('pagination keeps selected and end pages reachable at 10 and 67 pages', () => {
  for (const total of [1, 10, 67]) for (let current = 0; current < total; current++) {
    const pages = pageNumbers(current, total);
    assert.ok(pages.includes(current)); assert.ok(pages.includes(0)); assert.ok(pages.includes(total - 1));
    assert.ok(pages.length <= 9);
    assert.equal(new Set(pages.filter(n => typeof n === 'number')).size, pages.filter(n => typeof n === 'number').length);
  }
});
