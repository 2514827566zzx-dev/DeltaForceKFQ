"""Local IPC to the macOS input app; never use browser-generated DOM events."""
import json
import platform
import socket
import subprocess
import tempfile
import threading
import time
from pathlib import Path


class NativeBridge:
    def __init__(self):
        self.lock = threading.Lock()
        self.connection = None
        self.reader = None
        self.folder = None
        self.error = ''
        if platform.system() != 'Darwin':
            self.error = '本测试执行器仅支持 macOS，Windows 输入后台尚未接入。'
            return
        app = Path(__file__).resolve().parent / 'native/口风琴输入助手.app'
        if not (app / 'Contents/MacOS/HarmonicaInput').exists():
            self.error = '缺少口风琴输入助手，请先运行 native/build-mac.sh。'
            return
        self.folder = tempfile.TemporaryDirectory(prefix='dfh-', dir='/tmp')
        path = str(Path(self.folder.name) / 'input.sock')
        try:
            subprocess.run(['/usr/bin/open', '-n', '-g', str(app), '--args', '--socket', path], check=True, capture_output=True)
            deadline = time.monotonic() + 12
            while not Path(path).exists():
                if time.monotonic() > deadline:
                    raise RuntimeError('输入助手未启动，请重新启动本地服务。')
                time.sleep(0.05)
            self.connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            self.connection.settimeout(2)
            self.connection.connect(path)
            self.reader = self.connection.makefile('rb')
        except Exception as exc:
            self.error = str(exc)

    def call(self, op, **args):
        if self.error:
            raise RuntimeError(self.error)
        with self.lock:
            self.connection.sendall((json.dumps(dict(op=op, **args)) + '\n').encode())
            raw = self.reader.readline(65536)
            if not raw:
                raise RuntimeError('输入助手已退出，请重新启动本地服务。')
            result = json.loads(raw)
            if not result.get('ok'):
                raise RuntimeError(result.get('error', '输入发送失败'))
            return result

    def status(self):
        return self.call('status')

    def arm(self):
        return self.call('arm')

    def key(self, key, down):
        return self.call('emit', key=key, down=down)

    def mouse(self, button, down):
        return self.call('emit', button=button, down=down)

    def release(self):
        return self.call('release')

    def close(self):
        try:
            if self.connection:
                self.release()
        finally:
            if self.connection:
                self.connection.close()
            if self.reader:
                self.reader.close()
            if self.folder:
                self.folder.cleanup()
