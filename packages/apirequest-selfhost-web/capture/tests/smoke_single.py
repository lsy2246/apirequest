"""隔离的真实单机引擎回归；不修改系统代理、证书信任或用户会话。"""
import argparse
import http.client
import http.server
import json
import os
from pathlib import Path
import queue
import socket
import struct
import subprocess
import tempfile
import threading
import time


def free_port():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


class Engine:
    def __init__(self, executable, root, port):
        self.serial, self.events, self.logs = 0, queue.Queue(), []
        env = dict(os.environ, APIREQUEST_CAPTURE_PORT=str(port), APIREQUEST_CAPTURE_CONFIG=str(root),
                   APIREQUEST_CAPTURE_MANAGE='', APIREQUEST_CAPTURE_SERVER='false')
        self.process = subprocess.Popen([executable, '--quiet', '--set', 'server=false', '--set',
            'connection_strategy=lazy', '--set', f'confdir={root}', '-s', str(Path(__file__).resolve().parents[1] / 'recorder.py')],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        def consume():
            for line in self.process.stdout:
                if line.startswith('APIREQUEST_CAPTURE '):
                    self.events.put(json.loads(line[len('APIREQUEST_CAPTURE '):]))
                else:
                    self.logs.append(line[-1000:])
        def errors():
            for line in self.process.stderr:
                self.logs.append(line[-1000:])
        threading.Thread(target=consume, daemon=True).start()
        threading.Thread(target=errors, daemon=True).start()
        try:
            assert self.events.get(timeout=20).get('ready'), self.logs[-5:]
        except BaseException:
            self.close()
            raise

    def call(self, action, body=None):
        self.serial += 1
        key = str(self.serial)
        self.process.stdin.write(json.dumps(dict(action='capture_api', callID=key,
            body=dict(action=action, input=body or {}))) + '\n')
        self.process.stdin.flush()
        while True:
            event = self.events.get(timeout=35)
            if event.get('callID') == key:
                if event.get('error'):
                    raise RuntimeError(event['error'])
                return event.get('result')

    def close(self):
        if self.process.stdin and not self.process.stdin.closed:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=15)
        except subprocess.TimeoutExpired:
            self.process.kill(); self.process.wait(timeout=5)
        if self.process.returncode:
            raise AssertionError(self.logs[-5:])


def until(check):
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        result = check()
        if result:
            return result
        time.sleep(.05)
    raise AssertionError('等待归档或连接状态超时')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--executable', required=True)
    args = parser.parse_args()
    slow_started, release = threading.Event(), threading.Event()
    large = (b'0123456789' * 10000)
    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == '/slow':
                slow_started.set(); release.wait(timeout=10)
            data = large if self.path == '/large' else b'{"ok":true}'
            self.send_response(200); self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
        def log_message(self, *args):
            pass
    fixture = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=fixture.serve_forever, daemon=True); thread.start()
    port = free_port()
    engine = None
    def request(path):
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
        try:
            connection.request('GET', f'http://127.0.0.1:{fixture.server_port}{path}')
            response = connection.getresponse()
            return response.status, response.read()
        finally:
            connection.close()
    try:
        with tempfile.TemporaryDirectory(prefix='apirequest-single-smoke-') as temp:
            root = Path(temp)
            engine = Engine(args.executable, root, port)
            state = engine.call('status')
            assert state['state'] == 'stopped' and not state['recording'] and 'devices' not in state
            state = engine.call('capture_settings', dict(revision=state['revision'], mode='system', systemProxy=False, service=''))
            state = engine.call('record', {'recording': True})
            first = state['archiveID']
            assert state['recording'] and state['state'] == 'running'
            assert request('/large') == (200, large)
            def page(session):
                return engine.call('archive_page', {'session': session})
            entry = until(lambda: page(first)['entries'])[0]
            entry = until(lambda: (value if (value := engine.call('archive_entry', {'session': first, 'id': entry['id']})).get('responseComplete') else None))
            body = engine.call('archive_body', {'session': first, 'id': entry['id'], 'side': 'responseBody'})
            assert body['size'] == len(large) and body['next'] == 65536
            assert 'deviceId' not in entry and 'deviceName' not in entry
            with socket.create_connection(('127.0.0.1', port), timeout=5) as client:
                client.sendall(b'\x05\x01\x00')
                assert client.recv(2) == b'\x05\x00'
                client.sendall(b'\x05\x01\x00\x01' + socket.inet_aton('127.0.0.1') + struct.pack('!H', fixture.server_port))
                assert client.recv(10)[1] == 0
                client.sendall(b'GET /socks HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
                response = b''
                while data := client.recv(8192):
                    response += data
                assert b'200 OK' in response and response.endswith(b'{"ok":true}')
            # 暂停只停止新归档，仍有网络转发；暂停时也可以准备一个新会话。
            state = engine.call('record', {'recording': False})
            before = page(first)['total']; assert request('/paused')[0] == 200
            time.sleep(.1); assert page(first)['total'] == before
            state = engine.call('new_session'); second = state['archiveID']
            assert second != first and not state['recording']
            engine.call('archive_rename', {'session': second, 'name': '单机验收会话'})
            try:
                engine.call('archive_delete', {'session': second})
                raise AssertionError('活动会话被删除')
            except RuntimeError as failure:
                assert str(failure) == 'busy'
            state = engine.call('record', {'recording': True})
            assert request('/resume')[0] == 200
            until(lambda: page(second)['total'] == 1)
            # 跨会话的长请求继续写入启动时的归档，不能被新会话接走。
            result = []
            slow = threading.Thread(target=lambda: result.append(request('/slow'))); slow.start()
            assert slow_started.wait(timeout=5)
            third = engine.call('new_session')['archiveID']
            release.set(); slow.join(timeout=10); assert not slow.is_alive() and result[0][0] == 200
            until(lambda: any(x['id'] == second and not x['active'] for x in engine.call('archive_list')))
            assert page(third)['total'] == 0
            assert engine.call('replay', {'session': first, 'ids': [entry['id']]})['accepted'] == 1
            until(lambda: page(third)['total'] == 1)
            assert engine.call('session_status')['replayError'] == ''
            config = engine.call('session_status')
            rule = dict(action='local', enabled=True, name='本地响应', match='/mock', method='GET', value='created', status=201)
            engine.call('configure', {'revision': config['revision'], 'rules': [rule]})
            assert request('/mock') == (201, b'created')
            assert engine.call('session_status')['rules'][0]['name'] == '本地响应'
            for action, body in [('device_save', {}), ('capture_settings', {'revision': engine.call('status')['revision'], 'mode': 'wireguard', 'systemProxy': False})]:
                try:
                    engine.call(action, body); raise AssertionError('删除的入口仍可执行')
                except RuntimeError:
                    pass
            engine.call('stop')
            assert not engine.call('status')['recording']
            engine.close(); engine = None
            engine = Engine(args.executable, root, port)
            assert engine.call('status')['state'] == 'stopped'
            assert engine.call('session_status')['rules'][0]['name'] == '本地响应'
            assert any(x['id'] == second and x['name'] == '单机验收会话' for x in engine.call('archive_list'))
            engine.close(); engine = None
            with socket.socket() as check:
                assert check.connect_ex(('127.0.0.1', port)) != 0
            assert not (root / 'devices.json').exists()
            print('PASS real single capture: HTTP/SOCKS forwarding, disk replay, full body paging, pause/resume, new/rename sessions, active protection, in-flight session retention, rules, restart and port cleanup')
    finally:
        release.set()
        if engine:
            engine.close()
        fixture.shutdown(); fixture.server_close(); thread.join(timeout=5)


if __name__ == '__main__':
    main()
