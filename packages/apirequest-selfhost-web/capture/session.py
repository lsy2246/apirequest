"""抓包规则与磁盘请求重放；不保留原始请求的长期内存副本。"""
import asyncio
import json
import random
import re
from urllib.parse import urlsplit

from mitmproxy import connection, ctx, http
from capture_modes import capabilities
from replay import replay_flow


class Session:
    def __init__(self, emit, allowed, system, can_use_pac):
        self.emit, self.allowed = emit, allowed
        self.system, self.can_use_pac = system, can_use_pac
        self.system_lock = asyncio.Lock()
        self.rules = []
        self.archive = None
        self.paused = {}
        self.replay_task = None
        self.replay_error = ''
        self.capture = None

    def clear(self, resume=False):
        if resume:
            for event, _, _ in self.paused.values():
                event.set()

    def read_request(self, session, id):
        # 所有重放来源统一读取归档，先校验完整性和当前会话目标，再读取正文。
        # 路径只接受归档标识符，不能让本地命令读到归档目录以外的文件。
        if (not self.archive and not self.capture) or any(not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value) for value in (session, id)):
            raise ValueError('entry_unavailable')
        folder = (self.capture.root / 'sessions' if self.capture else self.archive.root.parent) / session / id
        try:
            entry = json.loads((folder / 'entry.json').read_text())
            if (not entry.get('originalRequest') or not entry.get('requestComplete') or not entry.get('replayable')
                    or entry.get('urlTruncated') or entry.get('requestHeadersTruncated')):
                raise ValueError('entry_unavailable')
            fields = [(key.encode('utf-8', 'surrogateescape'), value.encode('utf-8', 'surrogateescape')) for key, value in entry['requestHeaders']]
            request = http.Request.make(entry['method'], entry['url'])
            request.headers = http.Headers(fields)
            request.http_version = entry['protocol']
            if entry.get('requestTrailers'):
                request.trailers = http.Headers([(key.encode('utf-8', 'surrogateescape'), value.encode('utf-8', 'surrogateescape')) for key, value in entry['requestTrailers']])
            if request.http_version.startswith('HTTP/3') or request.headers.get('upgrade', '').lower() == 'websocket':
                raise ValueError('entry_unavailable')
            client = connection.Client(peername=(entry.get('client') or '127.0.0.1', 0), sockname=('127.0.0.1', 0))
            flow = http.HTTPFlow(client, connection.Server(address=(request.host, request.port)))
            flow.request = request
            if not self.allowed(flow):
                raise ValueError('entry_unavailable')
            body = folder / 'requestBody.bin'
            size = body.stat().st_size if body.exists() else 0
            if size != entry.get('requestSize', 0):
                raise ValueError('entry_unavailable')
            return flow, body
        except (OSError, KeyError, TypeError, json.JSONDecodeError):
            raise ValueError('entry_unavailable') from None

    async def replay_requests(self, session, ids):
        try:
            for id in ids:
                flow, body = self.read_request(session, id)
                # 只在执行这一条时加载正文；上一条发送完成后释放，批量操作不预加载全部正文。
                flow.request.raw_content = body.read_bytes() if body.exists() else b''
                flow.request.stream = False
                await replay_flow(flow)
                flow.request.raw_content = None
        except (OSError, ValueError):
            self.replay_error = 'entry_unavailable'
        except asyncio.CancelledError:
            raise
        except Exception:
            self.replay_error = 'engine_exited'
        finally:
            self.emit({'changed': True})

    async def stop_replay(self):
        if self.replay_task and not self.replay_task.done():
            self.replay_task.cancel()
            await asyncio.gather(self.replay_task, return_exceptions=True)
        self.replay_task = None

    def matching(self, flow, action):
        return next((rule for rule in self.rules if rule.get('enabled', True) and rule['action'] == action
                     and rule['match'] in flow.request.url
                     and (not rule['method'] or rule['method'] == flow.request.method)), None)

    async def pause(self, flow, phase):
        # 暂停记录后没有可操作的流量行，因此不新增不可见断点；其他规则仍照常执行。
        if self.capture and not self.capture.recording:
            return
        if not self.matching(flow, 'pause_' + phase):
            return
        event = asyncio.Event()
        self.paused[flow.id] = (event, flow, phase)
        self.trace(flow, 'pause_' + phase)
        self.emit({'id': flow.id, 'paused': phase}, flow)
        try:
            await asyncio.wait_for(event.wait(), 120)
        except asyncio.TimeoutError:
            pass
        finally:
            self.paused.pop(flow.id, None)
            self.emit({'id': flow.id, 'paused': None}, flow)

    async def request(self, flow):
        await self.pause(flow, 'request')
        network = self.matching(flow, 'network')
        if network:
            self.trace(flow, 'network')
            await asyncio.sleep(network['delayMs'] / 1000)
            if random.random() * 100 < network['loss']:
                flow.kill()
                return
        local = self.matching(flow, 'local')
        if local:
            self.trace(flow, 'local')
            flow.response = http.Response.make(local['status'], local['value'].encode(),
                                               {'Content-Type': local['contentType']})
        rewrite = self.matching(flow, 'rewrite')
        if rewrite and flow.response is None:
            self.trace(flow, 'rewrite')
            try:
                self.rewrite(flow, rewrite['value'])
            except ValueError:
                flow.response = http.Response.make(400, b'Rewrite must preserve the request origin')

    def trace(self, flow, action):
        rule = self.matching(flow, action)
        trace = flow.metadata.setdefault('capture_rule_trace', [])
        trace.append(dict(action=action, name=rule.get('name', '') if rule else '', match=rule['match'] if rule else ''))
        self.emit({'id': flow.id, 'ruleTrace': trace}, flow)

    def rewrite(self, flow, url):
        # 同源限制保留凭据的原始接收边界。
        if any(ord(char) < 32 or ord(char) == 127 for char in url):
            raise ValueError('invalid_rules')
        try:
            parts = urlsplit(url)
            port = parts.port or (443 if parts.scheme == 'https' else 80)
        except ValueError:
            raise ValueError('invalid_rules') from None
        if (parts.scheme != flow.request.scheme or parts.hostname != flow.request.host
                or port != flow.request.port or parts.username is not None):
            raise ValueError('invalid_rules')
        flow.request.url = url
        self.emit({'id': flow.id, 'rewritten': True}, flow)

    def resume(self, body):
        paused = self.paused.get(body.get('id'))
        if not paused:
            raise ValueError('entry_unavailable')
        event, flow, phase = paused
        patch = body.get('patch', {})
        if not isinstance(patch, dict) or set(patch) - {'headers', 'url', 'status', 'body'}:
            raise ValueError('invalid_rules')
        headers = patch.get('headers', {})
        protected = {'host', 'content-length', 'transfer-encoding', 'connection', 'upgrade',
                     'content-encoding', 'trailer', 'proxy-authorization', 'authorization', 'cookie', 'set-cookie'}
        if not isinstance(headers, dict) or len(headers) > 32:
            raise ValueError('invalid_rules')
        for name, value in headers.items():
            if (not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}", name)
                    or name.lower() in protected
                    or (value is not None and (not isinstance(value, str)
                        or len(value.encode()) > 4096 or any(ord(char) < 32 or ord(char) == 127 for char in value)))):
                raise ValueError('invalid_rules')
        if 'body' in patch and (not isinstance(patch['body'], str) or len(patch['body'].encode()) > 512 * 1024):
            raise ValueError('invalid_rules')
        if 'status' in patch and (phase != 'response' or type(patch['status']) is not int
                                  or not 200 <= patch['status'] <= 599 or patch['status'] in (204, 205, 304)):
            raise ValueError('invalid_rules')
        if 'url' in patch:
            if phase != 'request' or not isinstance(patch['url'], str) or len(patch['url']) > 8192:
                raise ValueError('invalid_rules')
            self.rewrite(flow, patch['url'])
        message = flow.request if phase == 'request' else flow.response
        if 'status' in patch:
            message.status_code = patch['status']
        for name, value in headers.items():
            if value is None:
                message.headers.pop(name, None)
            else:
                message.headers[name] = value
        if 'body' in patch:
            # 断点仅在头部阶段修改正文：清除长度和编码，由引擎重新计算传输语义。
            message.headers.pop('content-encoding', None)
            message.headers.pop('transfer-encoding', None)
            flow.metadata['capture_patch_' + phase] = patch['body'].encode()
            message.headers['content-length'] = str(len(patch['body'].encode()))
        event.set()

    def configure(self, body):
        if set(body) - {'rules'}:
            raise ValueError('invalid_rules')
        rules = body.get('rules', [])
        if not isinstance(rules, list) or len(rules) > 24:
            raise ValueError('invalid_rules')
        sanitized = []
        for rule in rules:
            if not isinstance(rule, dict):
                raise ValueError('invalid_rules')
            action = rule.get('action')
            match, method, value = rule.get('match'), rule.get('method', ''), rule.get('value', '')
            if (action not in ('pause_request', 'pause_response', 'rewrite', 'local', 'network')
                    or not isinstance(match, str) or not 1 <= len(match) <= 1024
                    or not isinstance(method, str) or (method and not re.fullmatch('[A-Za-z-]{1,16}', method))
                    or not isinstance(value, str) or len(value.encode()) > 32768):
                raise ValueError('invalid_rules')
            status, delay, loss = rule.get('status', 200), rule.get('delayMs', 0), rule.get('loss', 0)
            content_type = rule.get('contentType', 'application/json')
            if (type(status) is not int or not 200 <= status <= 599 or status in (204, 205, 304)
                    or type(delay) is not int or not 0 <= delay <= 10000
                    or type(loss) is not int or not 0 <= loss <= 100
                    or not isinstance(content_type, str) or not 1 <= len(content_type) <= 120
                    or '\r' in content_type or '\n' in content_type):
                raise ValueError('invalid_rules')
            if action == 'rewrite':
                try:
                    parts = urlsplit(value)
                    if (parts.scheme not in ('http', 'https') or not parts.hostname or parts.username is not None
                            or any(ord(char) < 32 or ord(char) == 127 for char in value)):
                        raise ValueError()
                    _ = parts.port
                except ValueError:
                    raise ValueError('invalid_rules') from None
            if not isinstance(rule.get('enabled', True), bool) or not isinstance(rule.get('name', ''), str) or len(rule.get('name', '')) > 120:
                raise ValueError('invalid_rules')
            if set(rule) - {'action', 'match', 'method', 'value', 'enabled', 'name', 'status', 'delayMs', 'loss', 'contentType'}:
                raise ValueError('invalid_rules')
            sanitized.append(dict(action=action, match=match, method=method.upper(), value=value, enabled=rule.get('enabled', True), name=rule.get('name', ''),
                                  status=status, delayMs=delay, loss=loss, contentType=content_type))
        self.rules = sanitized

    def system_command(self, action, body):
        if action == 'system_status':
            result = self.system.status(self.can_use_pac)
            result['capabilities'] = capabilities()
            return result
        if action == 'system_enable':
            if not self.can_use_pac:
                raise ValueError('system_unavailable')
            self.system.enable(body.get('service'))
        elif action == 'system_restore':
            self.system.restore()
        else:
            return {'trusted': self.system.trust(action.removeprefix('certificate_'))}
        return {}

    async def command(self, command):
        if not isinstance(command, dict):
            return
        call_id = command.get('callID')
        action = command.get('action')
        if not isinstance(action, str):
            return
        try:
            body = command.get('body', {})
            if not isinstance(body, dict):
                raise ValueError('invalid_rules')
            result = {}
            if action == 'capture_api':
                if not self.capture:
                    raise ValueError('engine_unavailable')
                if set(body) - {'action', 'input'}:
                    raise ValueError('invalid_target')
                result = await self.capture.api(body.get('action'), body.get('input', {}))
            elif action in ('system_status', 'system_enable', 'system_restore', 'certificate_status', 'certificate_install', 'certificate_remove'):
                async with self.system_lock:
                    result = await asyncio.to_thread(self.system_command, action, body)
            elif action == 'connection_info':
                result = self.capture_runtime.info()
            elif action == 'session_status':
                result = {'rules': self.rules, 'replayError': self.replay_error, 'archive': self.archive.status() if self.archive else None}
            elif action == 'configure':
                self.configure(body)
            elif action == 'resume':
                self.resume(body)
            elif action == 'replay':
                ids = body.get('ids')
                if (not isinstance(ids, list) or not ids
                        or any(not isinstance(id, str) for id in ids) or len(set(ids)) != len(ids)):
                    raise ValueError('entry_unavailable')
                if self.replay_task and not self.replay_task.done():
                    raise ValueError('busy')
                session = body.get('session')
                for id in ids:
                    self.read_request(session, id)
                self.replay_error = ''
                self.replay_task = asyncio.create_task(self.replay_requests(session, ids))
                result = {'accepted': len(ids)}
            elif action == 'clear':
                self.clear(resume=True)
            else:
                raise ValueError('forbidden')
            self.emit({'callID': call_id, 'result': result})
        except (ValueError, TypeError, KeyError) as error:
            code = str(error)
            self.emit({'callID': call_id, 'error': code if code in ('invalid_rules', 'entry_unavailable', 'forbidden', 'system_unavailable', 'existing_pac', 'busy', 'revision_conflict', 'invalid_target', 'port_unavailable', 'engine_unavailable', 'local_unavailable', 'local_start_failed', 'invalid_capture_mode', 'invalid_processes', 'capture_cleanup_failed', 'archive_failed') else 'engine_exited'})
        except Exception:
            self.emit({'callID': call_id, 'error': 'system_unavailable' if action.startswith(('system_', 'certificate_')) else 'engine_exited'})
