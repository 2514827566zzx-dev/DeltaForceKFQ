#!/usr/bin/env python3
"""Loopback-only UI and an authenticated native input control API."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import json
import secrets
import time
import threading
import webbrowser
from native_bridge import NativeBridge
from input_engine import InputEngine


class Handler(SimpleHTTPRequestHandler):
    def allowed(self):
        expected = {'127.0.0.1:%d' % self.server.server_port, 'localhost:%d' % self.server.server_port}
        host = self.headers.get('Host', '')
        origin = self.headers.get('Origin')
        return host in expected and (not origin or origin in {'http://' + h for h in expected}) and self.headers.get('Sec-Fetch-Site') != 'cross-site'

    def reply(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers(); self.wfile.write(raw)

    def do_GET(self):
        if not self.allowed():
            return self.reply({'error': '仅允许本机同源请求'}, 403)
        if self.path == '/api/session':
            return self.reply({'token': self.server.token, 'platform': 'macOS', 'state': self.server.engine.snapshot()})
        if self.path.startswith('/api/'):
            if not secrets.compare_digest(self.headers.get('X-Harmonica-Token', ''), self.server.token):
                return self.reply({'error': '本地会话已失效，请刷新页面'}, 403)
            if self.path == '/api/state':
                return self.reply(self.server.engine.snapshot())
            if self.path == '/api/events':
                return self.stream()
            return self.reply({'error': '不存在的接口'}, 404)
        return super().do_GET()

    def stream(self):
        client = self.headers.get('X-Harmonica-Client', '')[:80]
        if not client:
            return self.reply({'error': 'Missing client'}, 400)
        generation = secrets.token_hex(8)
        with self.server.clients_lock:
            self.server.clients[client] = generation
        self.send_response(200); self.send_header('Content-Type', 'application/x-ndjson'); self.end_headers()
        try:
            while True:
                self.wfile.write((json.dumps(self.server.engine.snapshot()) + '\n').encode())
                self.wfile.flush(); time.sleep(0.1)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with self.server.clients_lock:
                if self.server.clients.get(client) == generation:
                    del self.server.clients[client]
                    if self.server.engine.owner == client:
                        self.server.engine.stop()

    def do_POST(self):
        if not self.allowed():
            return self.reply({'error': '仅允许本机同源请求'}, 403)
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 16 * 1024 * 1024:
                return self.reply({'error': '请求大小无效'}, 413)
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                return self.reply({'error': '仅接受 JSON 请求'}, 415)
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError('请求格式无效')
            token = self.headers.get('X-Harmonica-Token') or data.get('token', '')
            if not isinstance(token, str) or not secrets.compare_digest(token, self.server.token):
                return self.reply({'error': '本地会话已失效，请刷新页面'}, 403)
            client = (self.headers.get('X-Harmonica-Client') or data.get('client', ''))[:80]
            with self.server.clients_lock:
                connected = client in self.server.clients
            engine = self.server.engine
            if self.path not in ('/api/stop', '/api/permission') and not connected:
                raise ValueError('控制页面已断开，请刷新后重试')
            if self.path == '/api/load':
                engine.load(data['score'], data['songId'], client, data.get('speed', 1))
            elif self.path == '/api/play':
                if engine.owner != client:
                    raise ValueError('曲目由另一个窗口选定，请重新选择曲目')
                engine.play()
            elif self.path == '/api/pause': engine.pause()
            elif self.path == '/api/stop':
                if engine.owner == client: engine.stop()
            elif self.path == '/api/seek': engine.seek(data['position'])
            elif self.path == '/api/speed': engine.set_speed(data['speed'])
            elif self.path == '/api/permission': self.server.bridge.call('permission')
            else: return self.reply({'error': '不存在的接口'}, 404)
            self.reply(engine.snapshot())
        except (ValueError, KeyError, TypeError) as exc:
            self.reply({'error': str(exc)}, 400)
        except Exception as exc:
            self.reply({'error': str(exc)}, 503)

    def log_message(self, fmt, *args):
        if self.path != '/api/state':
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    parser.add_argument('--target-app', help='Development acceptance test: refuse input to any other foreground app')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent / 'dist'
    handler = partial(Handler, directory=str(root))
    for port in range(args.port, args.port + 20):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), handler)
            break
        except OSError:
            if port == args.port + 19:
                raise
    url = 'http://127.0.0.1:%d' % server.server_port
    server.token = secrets.token_urlsafe(32)
    server.bridge = NativeBridge()
    server.engine = InputEngine(server.bridge, expected_target=args.target_app)
    server.clients = {}
    server.clients_lock = threading.Lock()
    print('Local: ' + url, flush=True)
    print('Keep this window open. Press Ctrl+C to stop.', flush=True)
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.engine.close()
        server.bridge.close()
        server.server_close()


if __name__ == '__main__':
    main()
