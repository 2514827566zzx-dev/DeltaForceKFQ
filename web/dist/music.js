// Independent of the UI and operating system; times are in score seconds.
export function parseMidi(buffer) {
  const data = new Uint8Array(buffer), view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = 0;
  const need = n => { if (p + n > data.length) throw new Error('MIDI 文件不完整'); };
  const byte = () => { need(1); return data[p++]; };
  const u16 = () => { need(2); const n = view.getUint16(p); p += 2; return n; };
  const u32 = () => { need(4); const n = view.getUint32(p); p += 4; return n; };
  const tag = () => String.fromCharCode(byte(), byte(), byte(), byte());
  function vlq() {
    let n = 0;
    for (let i = 0; i < 4; i++) { const b = byte(); n = n * 128 + (b & 127); if (!(b & 128)) return n; }
    throw new Error('无效的 MIDI 时间编码');
  }
  if (tag() !== 'MThd') throw new Error('这不是有效的 MIDI 文件');
  const headerSize = u32();
  if (headerSize < 6) throw new Error('无效的 MIDI 文件头');
  const format = u16(), tracks = u16(), division = u16();
  if (format > 1) throw new Error('请使用 Type 0 或 Type 1 MIDI 文件');
  if (!tracks || !division || (format === 0 && tracks !== 1)) throw new Error('无效的 MIDI 轨道或时间基准');
  need(headerSize - 6); p += headerSize - 6;
  const raw = [], tempos = [{ tick: 0, micros: 500000 }];
  let endTick = 0;
  for (let t = 0; t < tracks; t++) {
    if (tag() !== 'MTrk') throw new Error('MIDI 缺少音轨');
    const size = u32(); need(size); const end = p + size;
    let tick = 0, running = 0;
    const active = new Map();
    while (p < end) {
      tick += vlq();
      let status = byte();
      if (status < 128) { p--; status = running; if (!status) throw new Error('无效的 MIDI running status'); }
      else if (status < 240) running = status;
      if (status === 255) {
        const type = byte(), length = vlq(); need(length);
        if (p + length > end) throw new Error('MIDI 事件超出轨道');
        if (type === 81 && length === 3) {
          const micros = data[p] * 65536 + data[p + 1] * 256 + data[p + 2];
          if (!micros) throw new Error('无效的 MIDI 速度');
          tempos.push({ tick, micros });
        }
        p += length;
        if (type === 47) break;
      } else if (status === 240 || status === 247) {
        running = 0; const length = vlq(); need(length); p += length;
      } else {
        const type = status >> 4, channel = status & 15;
        if (type < 8 || type > 14) throw new Error('不支持的 MIDI 事件');
        const pitch = byte(), velocity = type === 12 || type === 13 ? 0 : byte();
        if (pitch > 127 || velocity > 127) throw new Error('无效的 MIDI 音符数据');
        const key = `${channel}:${pitch}`;
        if (type === 9 && velocity > 0) {
          if (!active.has(key)) active.set(key, []);
          active.get(key).push({ tick, pitch, velocity });
        } else if (type === 8 || (type === 9 && velocity === 0)) {
          const note = active.get(key)?.shift();
          if (note && tick > note.tick) raw.push({ ...note, end: tick });
        }
      }
      if (p > end) throw new Error('MIDI 事件超出轨道');
    }
    for (const queue of active.values()) for (const note of queue) if (tick > note.tick) raw.push({ ...note, end: tick });
    endTick = Math.max(endTick, tick); p = end;
  }
  tempos.sort((a, b) => a.tick - b.tick);
  const segments = [];
  let lastTick = 0, sec = 0, micros = 500000;
  for (const tempo of tempos) {
    sec += (tempo.tick - lastTick) * micros / (division * 1e6);
    segments.push({ tick: tempo.tick, sec, micros: tempo.micros });
    lastTick = tempo.tick; micros = tempo.micros;
  }
  let smpte = 0;
  if (division & 0x8000) {
    let fps = 256 - (division >> 8);
    if (![24, 25, 29, 30].includes(fps) || !(division & 255)) throw new Error('无效的 SMPTE 时间基准');
    if (fps === 29) fps = 30000 / 1001;
    smpte = fps * (division & 255);
  }
  function seconds(tick) {
    if (smpte) return tick / smpte;
    let lo = 0, hi = segments.length;
    while (lo + 1 < hi) { const m = (lo + hi) >> 1; if (segments[m].tick <= tick) lo = m; else hi = m; }
    const s = segments[lo]; return s.sec + (tick - s.tick) * s.micros / (division * 1e6);
  }
  const notes = raw.map(n => ({ time: seconds(n.tick), duration: seconds(n.end) - seconds(n.tick), pitch: n.pitch, velocity: n.velocity / 127 })).sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  if (!notes.length) throw new Error('MIDI 中没有可演奏的音符');
  const duration = notes.reduce((end, n) => Math.max(end, n.time + n.duration), seconds(endTick));
  if (!Number.isFinite(duration) || duration > 3600) throw new Error('曲目时长须在一小时以内');
  return { notes, duration, bpm: 6e7 / segments[0].micros };
}

export function parseTxt(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const bpm = Number(text.match(/BPM\s*[:：]?\s*(\d+(?:\.\d+)?)/i)?.[1] || 120);
  if (!(bpm >= 10 && bpm <= 1000)) throw new Error('TXT 的 BPM 应在 10–1000 之间');
  const notes = [], beatSec = 60 / bpm, scale = [0, 2, 4, 5, 7, 9, 11, 12];
  const header = /^\s*小节\s*\d+\s*(?:[（(](\d+)\s*\/\s*(\d+)[）)])?/;
  let time = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(header); if (!match) continue;
    const beats = match[1] ? Number(match[1]) * 4 / Number(match[2]) : 4;
    if (!Number.isFinite(beats) || beats <= 0) throw new Error('TXT 拍号无效');
    let keys, rhythms;
    while (i + 1 < lines.length && !header.test(lines[i + 1])) {
      const line = lines[++i].trim();
      if (line.startsWith('键位')) keys = line.replace(/^键位\s*[:：]?\s*/, '').trim().split(/\s+/);
      if (line.startsWith('节奏')) rhythms = line.replace(/^节奏\s*[:：]?\s*/, '').trim().split(/\s+/);
    }
    if (!keys?.length || !rhythms || rhythms.length !== keys.length) throw new Error('每小节的键位与节奏数量必须一致');
    const start = time;
    keys.forEach((key, index) => {
      const rhythm = rhythms[index].match(/^(\d+)([.·]*)$/);
      if (!rhythm || Number(rhythm[1]) <= 0) throw new Error(`无法识别节奏：${rhythms[index]}`);
      const duration = 4 / Number(rhythm[1]) * (2 - 2 ** -rhythm[2].length) * beatSec;
      if (!['0', '-', '休', '休止'].includes(key)) {
        const token = key.toUpperCase().replace('，', ',').match(/^([ZXCVBNM,])([+#-]*)$/);
        if (!token) throw new Error(`无法识别键位：${key}`);
        const mods = token[2], octave = (mods.match(/\+/g) || []).length - (mods.match(/-/g) || []).length;
        const pitch = 60 + scale['ZXCVBNM,'.indexOf(token[1])] + octave * 12 + (mods.includes('#') ? 1 : 0);
        if (pitch < 0 || pitch > 127) throw new Error('TXT 音符超出 MIDI 音域');
        notes.push({ time, duration, pitch, velocity: 0.75, input: { key: token[1], octave, sharp: mods.includes('#') } });
      }
      time += duration;
    });
    time = Math.max(time, start + Math.max(1, Math.round((time - start) / (beats * beatSec))) * beats * beatSec);
  }
  if (!notes.length) throw new Error('TXT 须包含「小节 / 键位 / 节奏」，且有有效音符');
  if (time > 3600) throw new Error('曲目时长须在一小时以内');
  return { notes, duration: time, bpm };
}

export function pageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i);
  const keep = new Set([0, total - 1, current - 1, current, current + 1]);
  if (current < 3) [1, 2, 3, 4].forEach(n => keep.add(n));
  if (current > total - 4) [total - 5, total - 4, total - 3, total - 2].forEach(n => keep.add(n));
  const pages = [...keep].filter(n => n >= 0 && n < total).sort((a, b) => a - b), result = [];
  for (const page of pages) { if (result.length && page - result[result.length - 1] > 1) result.push('…'); result.push(page); }
  return result;
}

export const formatTime = sec => `${Math.floor(Math.max(0, sec) / 60)}:${String(Math.floor(Math.max(0, sec) % 60)).padStart(2, '0')}`;
