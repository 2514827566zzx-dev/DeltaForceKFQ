// The backend's monotonic clock and actual input worker are authoritative.
// There is intentionally no audio or DOM-keyboard fallback.
export class NativePlayer {
  constructor(onChange, onError) {
    this.onChange = onChange; this.onError = onError;
    this.client = crypto.randomUUID(); this.speed = 1; this.position = 0;
    this.state = 'idle'; this.score = null; this.scoreId = ''; this.countdown = 0;
    this.sequence = 0; this.updated = performance.now(); this.queue = Promise.resolve();
    this.lastError = ''; this.connected = false;
  }
  get playing() { return this.state === 'playing' || this.state === 'countdown'; }
  get time() {
    return this.state === 'playing' ? Math.min(this.score?.duration || 0, this.position + (performance.now() - this.updated) / 1000 * this.speed) : this.position;
  }
  apply(state) {
    if (state.sequence <= this.sequence) return;
    this.sequence = state.sequence;
    if (state.owner && state.owner !== this.client) return;
    this.state = state.state; this.position = state.position; this.updated = performance.now();
    this.countdown = state.countdown;
    if (state.songId) this.speed = state.speed;
    if (state.error && state.error !== this.lastError) this.onError(state.error);
    this.lastError = state.error || '';
    this.onChange();
  }
  async ready() {
    if (this.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const response = await fetch('/api/session');
      if (!response.ok) throw new Error('本地输入服务未启动，请运行新版启动脚本。');
      const session = await response.json(); this.token = session.token;
      const stream = await fetch('/api/events', { headers: this.headers() });
      if (!stream.ok) throw new Error('无法连接本地输入服务，请刷新重试。');
      this.reader = stream.body.getReader(); this.connected = true;
      this.consume().catch(() => {
        this.connected = false; this.state = 'idle'; this.onChange();
        this.onError('本地输入连接已断开，演奏已停止。请刷新页面重新连接。');
      });
    })().finally(() => { this.connecting = null; });
    return this.connecting;
  }
  headers() { return { 'Content-Type': 'application/json', 'X-Harmonica-Token': this.token, 'X-Harmonica-Client': this.client }; }
  async consume() {
    const decoder = new TextDecoder(); let pending = '';
    while (true) {
      const { value, done } = await this.reader.read();
      if (done) throw new Error('Disconnected');
      pending += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        this.apply(JSON.parse(pending.slice(0, newline))); pending = pending.slice(newline + 1);
      }
    }
  }
  command(action, body = {}) {
    const task = this.queue.catch(() => {}).then(async () => {
      await this.ready();
      const response = await fetch(`/api/${action}`, { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '系统输入操作失败');
      this.apply(result); return result;
    });
    this.queue = task; return task;
  }
  async load(score, songId, title = '') {
    this.score = score; this.scoreId = songId;
    return this.command('load', { score, songId, title, speed: this.speed });
  }
  play() { return this.command('play'); }
  pause() { return this.command('pause'); }
  stop() { return this.command('stop'); }
  seek(position) { return this.command('seek', { position }); }
  setSpeed(speed) { return this.command('speed', { speed }); }
  close() {
    if (this.token) navigator.sendBeacon('/api/stop', new Blob([JSON.stringify({token:this.token,client:this.client})], {type:'application/json'}));
    this.reader?.cancel().catch(() => {});
  }
}
