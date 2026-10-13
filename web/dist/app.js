import { parseMidi, parseTxt, pageNumbers, formatTime } from './music.js';
import { NativePlayer } from './native-player.js';
import { readImports, saveImport } from './storage.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const SPEEDS = [0.5, 0.8, 1, 1.2, 1.5, 2];
let songs = [], selected, page = 0, onlyFavorites = false, query = '', pip, noticeTimer, selectionVersion = 0, playVersion = 0, importing = false;
let prefs;
try { prefs = JSON.parse(localStorage.getItem('harmonica-preferences') || '{}'); } catch { prefs = {}; }
if (!prefs || typeof prefs !== 'object') prefs = {};
const favorites = new Set(Array.isArray(prefs.favorites) ? prefs.favorites : []);
const cache = new Map();
const player = new NativePlayer(updateControls, notice);
if (SPEEDS.includes(prefs.speed)) player.speed = prefs.speed;

function notice(message) {
  clearTimeout(noticeTimer);
  for (const doc of [document, pip?.document].filter(Boolean)) {
    const el = doc.querySelector('#notice'); if (el) { el.textContent = message; el.hidden = false; }
  }
  noticeTimer = setTimeout(() => {
    for (const doc of [document, pip?.document].filter(Boolean)) { const el = doc.querySelector('#notice'); if (el) el.hidden = true; }
  }, 6500);
}
function savePrefs() {
  try { localStorage.setItem('harmonica-preferences', JSON.stringify({ favorites: [...favorites], selected: selected?.id, speed: player.speed })); }
  catch { notice('浏览器未允许保存设置，本次操作仍然有效。'); }
}
function visibleSongs() {
  return songs.filter(s => s.name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()) && (!onlyFavorites || favorites.has(s.id)))
    .sort((a, b) => Number(favorites.has(b.id)) - Number(favorites.has(a.id)));
}
function renderList() {
  const list = visibleSongs(), pages = Math.max(1, Math.ceil(list.length / 10));
  page = Math.max(0, Math.min(page, pages - 1));
  $('#songs').innerHTML = list.slice(page * 10, page * 10 + 10).map(song => {
    const active = selected?.id === song.id, fav = favorites.has(song.id);
    return `<li class="flex items-center ${active ? 'bg-white/[0.06]' : ''}">
      <button data-song="${escape(song.id)}" aria-current="${active}" title="${escape(song.name)}" class="song-button flex flex-1 items-center gap-3 px-2 py-2 text-left text-sm ${active ? 'text-white' : 'text-white/55 hover:text-white'}">
        <span class="h-1.5 w-1.5 rounded-full ${active ? 'bg-[#FFB800]' : 'bg-transparent'}" style="flex-shrink:0"></span><span class="flex-1 truncate">${escape(song.name)}</span><span class="song-duration font-mono text-[11px] text-white/35">${formatTime(song.duration)}</span>
      </button><button data-favorite="${escape(song.id)}" aria-label="${fav ? '取消收藏' : '收藏'} ${escape(song.name)}" aria-pressed="${fav}" title="${fav ? '取消收藏' : '收藏'}" class="px-3 py-2 text-sm ${fav ? 'text-[#FFB800]' : 'text-white/20 hover:text-white/60'}">${fav ? '★' : '☆'}</button>
    </li>`;
  }).join('') || `<li class="py-6 text-center text-xs text-white/30">${onlyFavorites ? '暂无收藏歌曲' : '没有匹配的歌曲'}</li>`;
  $('#song-count').textContent = `共 ${list.length} 首`;
  $('#pagination').innerHTML = `<button data-page="${page - 1}" ${page === 0 ? 'disabled' : ''} class="px-2 py-1 hover:text-white disabled:opacity-25 disabled:hover:text-white/40">‹ 上一页</button>` +
    pageNumbers(page, pages).map(n => n === '…' ? '<span class="px-2" aria-hidden="true">…</span>' : `<button data-page="${n}" aria-label="第 ${n + 1} 页" ${n === page ? 'aria-current="page"' : ''} class="w-6 py-1 ${n === page ? 'bg-[#FFB800] text-black' : 'hover:text-white'}">${n + 1}</button>`).join('') +
    `<button data-page="${page + 1}" ${page === pages - 1 ? 'disabled' : ''} class="px-2 py-1 hover:text-white disabled:opacity-25 disabled:hover:text-white/40">下一页 ›</button>`;
  $('#favorites-filter').setAttribute('aria-pressed', String(onlyFavorites));
  $('#favorites-filter').className = `h-8 border px-3 text-xs ${onlyFavorites ? 'border-[#FFB800] bg-[#FFB800]/15 text-[#FFB800]' : 'border-white/10 text-white/50 hover:text-white'}`;
}
function updateControls() {
  for (const doc of [document, pip?.document].filter(Boolean)) {
    const status = doc.querySelector('#status'); if (status) status.textContent = player.state === 'countdown' ? `准备 ${Math.ceil(player.countdown)} 秒 · 请切换到接收窗口` : player.playing ? 'PLAYING' : 'READY';
    const title = doc.querySelector('#song-name'); if (title && selected) { title.textContent = selected.name; title.title = selected.name; }
    doc.querySelectorAll('[data-play-label]').forEach(el => el.textContent = player.playing ? '暂停' : (doc === document ? '开始演奏' : '播放'));
    doc.querySelectorAll('[data-action="play"]').forEach(el => el.disabled = !player.score);
    const dot = doc.querySelector('[data-dot]'); if (dot) dot.className = `h-1.5 w-1.5 rounded-full ${player.playing ? 'bg-[#FFB800] blink' : 'bg-white/30'}`;
    const speed = doc.querySelector('[data-speed-label]'); if (speed) speed.textContent = `${player.speed}×`;
    doc.querySelectorAll('[data-speed]').forEach(button => {
      const active = Number(button.dataset.speed) === player.speed;
      button.className = `w-11 py-1 font-mono text-xs ${active ? 'bg-white text-black' : 'text-white/50 hover:text-white'}`;
      button.setAttribute('aria-pressed', String(active));
    });
  }
  updateProgress();
}
function updateProgress() {
  const duration = selected?.duration || 0, pos = player.time;
  for (const doc of [document, pip?.document].filter(Boolean)) {
    doc.querySelectorAll('[data-elapsed]').forEach(el => el.textContent = formatTime(pos / player.speed));
    doc.querySelectorAll('[data-duration]').forEach(el => el.textContent = formatTime(duration / player.speed));
    doc.querySelectorAll('[data-fill]').forEach(el => el.style.width = `${duration ? pos / duration * 100 : 0}%`);
    doc.querySelectorAll('[data-progress]').forEach(el => {
      el.setAttribute('aria-valuenow', String(Math.round(duration ? pos / duration * 100 : 0)));
      el.setAttribute('aria-valuetext', `${formatTime(pos / player.speed)} / ${formatTime(duration / player.speed)}`);
    });
  }
}
async function scoreFor(song) {
  if (song.score) return song.score;
  if (!cache.has(song.id)) cache.set(song.id, (async () => {
    const response = await fetch(song.file); if (!response.ok) throw new Error('曲谱读取失败，请重新打开页面');
    return parseMidi(await response.arrayBuffer());
  })().catch(error => { cache.delete(song.id); throw error; }));
  return cache.get(song.id);
}
async function pick(id) {
  const song = songs.find(s => s.id === id); if (!song) return;
  const version = ++selectionVersion; playVersion++;
  try {
    await player.stop();
    if (version !== selectionVersion) return;
    player.score = null; selected = song; renderList(); updateControls(); savePrefs();
    const score = await scoreFor(song);
    if (version !== selectionVersion) return;
    await player.load(score, song.id); updateControls();
  } catch (error) { if (version === selectionVersion) notice(error.message); }
}
async function togglePlay() {
  const version = ++playVersion;
  try {
    if (player.playing) { await player.pause(); return; }
    if (!player.score) return;
    await player.ready(); if (version === playVersion) await player.play();
  } catch (error) { notice(error.message); }
}
function expand() { pip?.close(); }
async function minimize() {
  if (pip && !pip.closed) { expand(); return; }
  if (!window.documentPictureInPicture?.requestWindow) {
    notice('当前浏览器不支持悬浮挂件，请用支持文档画中画的新版 Chrome 或 Edge 打开此本地地址。'); return;
  }
  try {
    pip = await window.documentPictureInPicture.requestWindow({ width: 256, height: 96, disallowReturnToOpener: false });
    const doc = pip.document; doc.documentElement.lang = 'zh-CN'; doc.title = '口风琴 · 悬浮挂件';
    document.querySelectorAll('link[rel="stylesheet"]').forEach(link => { const copy = doc.createElement('link'); copy.rel = 'stylesheet'; copy.href = link.href; doc.head.append(copy); });
    doc.body.className = 'pip-body';
    doc.body.innerHTML = `<section class="widget border border-white/10 bg-black/65 p-3 backdrop-blur-md" aria-label="悬浮挂件">
      <div class="flex items-center gap-2"><span data-dot class="h-1.5 w-1.5 rounded-full bg-white/30" style="flex-shrink:0"></span><p id="song-name" class="widget-title flex-1 truncate text-sm text-white"></p><button data-action="expand" title="展开" aria-label="展开" class="text-white/40 hover:text-white">⤢</button></div>
      <div class="mt-2.5"><div data-progress role="slider" tabindex="0" aria-label="演奏进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" class="progress relative w-full cursor-pointer bg-white/10 h-1"><div data-fill class="h-full bg-[#FFB800]" style="width:0%"></div></div></div>
      <div class="mt-2 flex items-center justify-between"><span class="font-mono text-[10px] text-white/40"><span data-elapsed>0:00</span> · <span data-speed-label>1×</span></span><div class="flex gap-3 text-xs"><button data-action="play" class="font-semibold text-[#FFB800]"><span data-play-label>播放</span></button><button data-action="next" class="text-white/60 hover:text-white">下一首</button><button data-action="stop" class="text-white/60 hover:text-white">停止</button></div></div>
    </section><div id="notice" class="notice" role="alert" hidden></div>`;
    bindDocument(doc); updateControls(); $('#app').hidden = true;
    pip.addEventListener('pagehide', () => { pip = undefined; $('#app').hidden = false; updateControls(); $('[data-action="minimize"]').focus(); }, { once: true });
  } catch { notice('悬浮窗口未能打开，请再次点击“收为挂件”。'); }
}
async function onClick(event) {
  const button = event.target.closest('button'); if (!button || button.disabled) return;
  try {
    if (button.dataset.song) return await pick(button.dataset.song);
    if (button.dataset.favorite) {
      const id = button.dataset.favorite; favorites.has(id) ? favorites.delete(id) : favorites.add(id);
      savePrefs(); renderList(); return;
    }
    if (button.dataset.page !== undefined) { page = Number(button.dataset.page); renderList(); return; }
    if (button.dataset.speed) { playVersion++; await player.setSpeed(Number(button.dataset.speed)); savePrefs(); return; }
    switch (button.dataset.action) {
      case 'play': await togglePlay(); break;
      case 'stop': playVersion++; await player.stop(); break;
      case 'minimize': await minimize(); break;
      case 'expand': expand(); break;
      case 'next': {
        const list = visibleSongs(); if (!list.length) return;
        const index = list.findIndex(s => s.id === selected?.id);
        await pick(list[(index + 1) % list.length].id); break;
      }
      case 'filter': onlyFavorites = !onlyFavorites; page = 0; renderList(); break;
      case 'import': if (!importing) $('#file-input').click(); break;
    }
  } catch (error) { notice(error.message || '操作未能完成，请重试。'); }
}
function bindDocument(doc) {
  doc.addEventListener('click', onClick);
  doc.addEventListener('keydown', event => {
    if (event.repeat) return;
    if (event.shiftKey && ['F1', 'F2', 'F9'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'F1') minimize();
      // While the native app is listening, Shift+F2/F9 are handled globally.
      // Handling them here as well would immediately toggle twice.
    } else if (event.target.matches('[data-progress]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const pos = event.key === 'Home' ? 0 : event.key === 'End' ? selected?.duration || 0 : player.time + (event.key === 'ArrowLeft' ? -5 : 5) * player.speed;
      player.seek(pos).catch(error => notice(error.message));
    }
  });
  doc.addEventListener('pointerdown', event => {
    const track = event.target.closest('[data-progress]'); if (!track || !player.score) return;
    event.preventDefault(); track.focus(); track.setPointerCapture(event.pointerId);
    const seek = e => {
      const rect = track.getBoundingClientRect();
      const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * selected.duration;
      player.seek(pos).catch(error => notice(error.message));
    };
    seek(event);
    track.addEventListener('pointermove', seek);
    const done = () => { track.removeEventListener('pointermove', seek); track.removeEventListener('pointerup', done); track.removeEventListener('pointercancel', done); };
    track.addEventListener('pointerup', done); track.addEventListener('pointercancel', done);
  });
}
$('#search').addEventListener('input', event => { query = event.target.value; page = 0; renderList(); });
$('#file-input').addEventListener('change', async event => {
  importing = true; let added = 0, duplicate = 0, first;
  const errors = [];
  try {
    for (const file of event.target.files) {
      try {
        if (file.size > 20 * 1024 * 1024) throw new Error('单个曲谱不可超过 20 MB');
        const data = await file.arrayBuffer();
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(n => n.toString(16).padStart(2, '0')).join('');
        if (songs.some(s => s.hash === hash)) { duplicate++; continue; }
        const ext = file.name.split('.').pop().toLowerCase(); let score;
        if (['mid', 'midi'].includes(ext)) score = parseMidi(data);
        else if (ext === 'txt') {
          let text;
          try { text = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { text = new TextDecoder('gb18030').decode(data); }
          score = parseTxt(text);
        } else throw new Error('只支持 MIDI / TXT 曲谱');
        const song = { id: `import-${hash}`, hash, name: file.name.replace(/\.(mid|midi|txt)$/i, ''), duration: score.duration, bpm: score.bpm, score };
        await saveImport(song); songs.push(song); added++; first ||= song;
      } catch (error) { errors.push(`${file.name}：${error.message}`); }
    }
    if (first) {
      query = ''; onlyFavorites = false; $('#search').value = '';
      page = Math.floor(visibleSongs().findIndex(s => s.id === first.id) / 10); await pick(first.id);
    }
    renderList();
    notice([added ? `已导入 ${added} 首` : '', duplicate ? `${duplicate} 首已在曲库中` : '', ...errors.slice(0, 3), errors.length > 3 ? `另有 ${errors.length - 3} 个文件未能导入` : ''].filter(Boolean).join('\n'));
  } finally { event.target.value = ''; importing = false; }
});
$('#speeds').innerHTML = SPEEDS.map(speed => `<button data-speed="${speed}" aria-label="${speed} 倍速">${speed}×</button>`).join('');
bindDocument(document);
setInterval(updateProgress, 100);
window.addEventListener('pagehide', () => { player.close(); pip?.close(); });

async function boot() {
  try {
    const response = await fetch('assets/library.json'); if (!response.ok) throw new Error('曲库加载失败');
    songs = await response.json();
    try { songs.push(...await readImports()); } catch { notice('本地存储不可用，导入功能需要允许此网站保存数据。'); }
    if (!('favorites' in prefs) && songs[0]) favorites.add(songs[0].id);
    const initial = songs.find(s => s.id === prefs.selected) || songs[0];
    if (initial) await pick(initial.id);
  } catch (error) { $('#song-name').textContent = '曲库暂时无法读取'; notice(`${error.message}。请通过本地启动脚本打开，并刷新重试。`); }
}
boot();
