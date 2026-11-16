"""本地调试代理。只复制有限的预览字节，正文照常向另一端流式转发。"""
import asyncio
import base64
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time
import zlib

from mitmproxy import ctx, http
sys.path.insert(0, str(Path(__file__).resolve().parent))
from archive import Archive
from session import Session
from memory import PREVIEW_WINDOW, PREVIEWS
from system_proxy import SystemProxy
from capture_modes import CaptureRuntime, capabilities
from capture_context import CURRENT_CONNECTION

EVENTS = queue.Queue(maxsize=256)
CONTROLS = queue.Queue(maxsize=64)
WAKE = threading.Event()
CHANGED = threading.Event()
OUTPUT_LOCK = threading.Lock()
ARCHIVE = None
LISTENER = None
CONNECTIONS = {}


def emit(event, flow=None):
    if flow is not None and LISTENER is not None and LISTENER.mode == 'control':
        archive = flow.metadata.get('capture_archive')
        if archive is not None and isinstance(event.get('id'), str):
            archive.submit('event', event['id'], event)
        return
    if ARCHIVE is not None and isinstance(event.get('id'), str):
        ARCHIVE.submit('event', event['id'], event)
        return
    try:
        (CONTROLS if 'callID' in event or event.get('ready') else EVENTS).put_nowait(event)
        WAKE.set()
    except queue.Full:
        # 工作台来不及读取时丢弃预览事件，继续转发原始流量。
        pass


def write_event(event):
    with OUTPUT_LOCK:
        sys.stdout.write('APIREQUEST_CAPTURE ' + json.dumps(event, ensure_ascii=True, separators=(',', ':')) + '\n')
        sys.stdout.flush()


def notify_archive():
    # One pending invalidation, independent of body size or the number of requests.
    CHANGED.set()
    WAKE.set()


def write_events():
    while True:
        WAKE.clear()
        try:
            event = CONTROLS.get_nowait()
        except queue.Empty:
            if CHANGED.is_set():
                CHANGED.clear()
                event = {'changed': True}
            else:
                try:
                    event = EVENTS.get_nowait()
                except queue.Empty:
                    WAKE.wait()
                    continue
        write_event(event)


def headers(message):
    # 本地抓包完整保存原始头部，认证信息与正文统一归档，不再依赖内存中的另一份请求。
    values = message if isinstance(message, http.Headers) else message.headers
    return [[key, value] for key, value in values.items(multi=True)]


def allowed(flow):
    return LISTENER.allowed(flow.request.host, flow.request.port)


def local_capture(flow):
    if LISTENER.mode != 'control':
        return LISTENER.mode == 'local'
    return LISTENER.runtime is not None and LISTENER.runtime.mode == 'local'


def target_error():
    return b'Capture cannot proxy its own listener or workbench'


async def close_engine(session):
    # 原生授权尚未完成时取消本次启动；系统设置写入已开始时仍等待完成再恢复。
    startup = getattr(session, 'startup_task', None)
    if startup and not startup.done():
        startup.cancel()
    async with session.system_lock:
        session.clear(resume=True)
        await session.stop_replay()
        try:
            await LISTENER.close()
        except Exception:
            write_event({'fatalError': 'capture_cleanup_failed'})
        finally:
            ctx.master.shutdown()


def read_commands(loop, session):
    try:
        for line in sys.stdin.buffer:
            if len(line) <= 1024 * 1024:
                try:
                    command = json.loads(line)
                except (ValueError, UnicodeDecodeError):
                    continue
                asyncio.run_coroutine_threadsafe(session.command(command), loop)
    finally:
        # 父进程异常退出时也关闭监听并恢复系统代理。
        asyncio.run_coroutine_threadsafe(close_engine(session), loop)


class Preview:
    def __init__(self, flow, side, message):
        self.flow, self.side = flow, side
        self.replacement = flow.metadata.pop('capture_patch_' + ('request' if side == 'requestBody' else 'response'), None)
        self.data = bytearray()
        self.preview_reserved = 0
        self.total = 0
        self.last = 0.0
        self.truncated = False
        encoding = message.headers.get('content-encoding', 'identity').lower().strip()
        self.encoded = encoding not in ('', 'identity', 'gzip', 'deflate')
        self.decoder = zlib.decompressobj(31) if encoding == 'gzip' else zlib.decompressobj() if encoding == 'deflate' else None

    def __call__(self, chunk):
        if self.replacement is not None:
            if chunk:
                return b''
            replacement, self.replacement = self.replacement, None
            self.consume(replacement)
            self.consume(b'')
            return replacement
        return self.consume(chunk)

    def consume(self, chunk):
        self.total += len(chunk)
        # 完整正文始终逐块归档，与预览大小、规则配置和重放操作无关。
        archive = self.flow.metadata.get('capture_archive', ARCHIVE)
        if chunk and archive is not None:
            archive.submit(self.side, self.flow.id, bytes(chunk))
        if chunk and not self.encoded and not self.truncated:
            left = max(0, PREVIEW_WINDOW - len(self.data))
            try:
                decoded = self.decoder.decompress(chunk, max(left + 1, 1)) if self.decoder else chunk
                size = PREVIEWS.take(min(left, len(decoded)))
                self.data.extend(decoded[:size])
                self.preview_reserved += size
                self.truncated = len(decoded) > size
            except zlib.error:
                self.encoded = True
        now = time.monotonic()
        if not chunk or now - self.last > 0.5:
            self.last = now
            text = None if self.encoded else self.text_preview()
            body = dict(text=text, size=self.total, truncated=self.truncated)
            if text is None and self.data:
                body['base64'] = base64.b64encode(self.data).decode('ascii')
            emit({'id': self.flow.id, self.side: body}, self.flow)
        return chunk

    def text_preview(self):
        if not self.data:
            return ''
        try:
            data = bytes(self.data).decode('utf-8', errors='strict')
        except UnicodeDecodeError as error:
            if error.reason == 'unexpected end of data' and error.end == len(self.data):
                data = bytes(self.data[:error.start]).decode('utf-8')
            else:
                return None
        return None if '\x00' in data else data

    def release_preview(self):
        PREVIEWS.release(self.preview_reserved)
        self.preview_reserved = 0
        self.data.clear()

    def __del__(self):
        self.release_preview()


class Recorder:
    async def running(self):
        global ARCHIVE, LISTENER
        port = int(os.environ['APIREQUEST_CAPTURE_PORT'])
        hosts = json.loads(os.environ.get('APIREQUEST_CAPTURE_INTERNAL_HOSTS', '[]'))
        ports = json.loads(os.environ.get('APIREQUEST_CAPTURE_INTERNAL_PORTS', '[3000,3001,3170,3171]'))
        system = SystemProxy(os.environ['APIREQUEST_CAPTURE_CONFIG'], port, hosts, ports)
        self.session = Session(emit, allowed, system, True)
        try:
            from controller import CaptureController
            LISTENER = CaptureController(ctx.master.addons.get('proxyserver'), os.environ['APIREQUEST_CAPTURE_CONFIG'], hosts, ports, self.session, port, on_change=notify_archive)
            self.session.capture_runtime = LISTENER
            self.session.capture = LISTENER
            self.session.configure({'rules': LISTENER.config['rules']})
            await LISTENER.start()
        except (OSError, ValueError):
            write_event({'fatalError': 'engine_unavailable'})
            ctx.master.shutdown()
            return
        threading.Thread(target=read_commands, args=(asyncio.get_running_loop(), self.session), daemon=True).start()
        threading.Thread(target=write_events, daemon=True).start()
        emit({'ready': True, 'archiveID': '', 'mode': 'control', 'endpoint': ''})

    def done(self):
        if LISTENER:
            try:
                LISTENER.stop()
            except Exception:
                write_event({'fatalError': 'capture_cleanup_failed'})
        if ARCHIVE is not None:
            ARCHIVE.close()
            write_event({'archiveStatus': ARCHIVE.status()})
        if hasattr(self, 'session'):
            try:
                self.session.system.restore()
            except Exception:
                # 快照保留给下次启动重试。
                pass

    def client_connected(self, client):
        identity = CURRENT_CONNECTION.get()
        if identity:
            CONNECTIONS[client.id] = identity

    def client_disconnected(self, client):
        CONNECTIONS.pop(client.id, None)

    def http_connect(self, flow):
        # 在 TLS 握手之前阻止连接自身与工作台，其他目标不需要预先登记。
        if not allowed(flow):
            flow.response = http.Response.make(403, target_error())

    async def server_connect(self, data):
        if not data.server.address or not await LISTENER.allowed_connection(data.server.address):
            data.server.error = target_error().decode()

    async def requestheaders(self, flow):
        if not allowed(flow):
            if local_capture(flow):
                flow.request.stream = True
            else:
                flow.response = http.Response.make(403, target_error())
            return
        self.begin(flow)
        await self.session.request(flow)
        emit({'id': flow.id, 'url': flow.request.url, 'requestHeaders': headers(flow.request)}, flow)
        if not flow.is_replay and flow.metadata.get('apirequest_capture'):
            flow.request.stream = Preview(flow, 'requestBody', flow.request)

    def begin(self, flow):
        identity = CONNECTIONS.get(flow.client_conn.id) or CURRENT_CONNECTION.get() or {}
        extra = {key: identity[key] for key in ('application', 'processId') if key in identity}
        if not LISTENER.recording and not flow.is_replay:
            flow.request.stream = True
            return
        archive = LISTENER.archive
        if archive is None:
            return
        archive.pending = getattr(archive, 'pending', 0) + 1
        flow.metadata['capture_archive'] = archive
        flow.metadata['capture_archive_open'] = True
        extra.update(sessionId=archive.id)
        flow.metadata['apirequest_capture'] = True
        emit({'id': flow.id, 'begin': True, 'method': flow.request.method,
              'url': flow.request.url, 'originalRequest': True,
              'protocol': flow.request.http_version,
              'startedAt': int(flow.request.timestamp_start * 1000),
              'client': str(flow.client_conn.peername[0]) if flow.client_conn.peername else '',
              'requestHeaders': headers(flow.request), **extra}, flow)
    async def responseheaders(self, flow):
        if not flow.metadata.get('apirequest_capture'):
            flow.response.stream = True
            return
        await self.session.pause(flow, 'response')
        emit({'id': flow.id, 'status': flow.response.status_code,
              'responseHeaders': headers(flow.response),
              'responseProtocol': flow.response.http_version,
              'contentType': flow.response.headers.get('content-type', ''),
              'server': str(flow.server_conn.peername[0]) if flow.server_conn.peername else '',
              'timings': self.timings(flow), 'timingOffsets': self.timing_offsets(flow),
              'firstByteMs': max(0, round((flow.response.timestamp_start - flow.request.timestamp_start) * 1000))}, flow)
        flow.response.stream = Preview(flow, 'responseBody', flow.response)

    async def request(self, flow):
        if flow.is_replay and not flow.metadata.get('apirequest_capture') and allowed(flow):
            self.begin(flow)
            await self.session.request(flow)
        if flow.metadata.get('apirequest_capture'):
            if not isinstance(flow.request.stream, Preview) and flow.request.raw_content is not None:
                # 引擎重放使用已缓冲正文，仍需生成与正常请求一致的预览。
                preview = Preview(flow, 'requestBody', flow.request)
                preview(flow.request.raw_content)
                preview(b'')
            stream = flow.request.stream
            size = stream.total if isinstance(stream, Preview) else len(flow.request.raw_content or b'')
            # 只有完整落盘的请求才标记可重放；旧记录缺少的认证头不能凭空恢复。
            path = flow.metadata.get('capture_archive', ARCHIVE).root / flow.id / 'requestBody.bin'
            complete = path.stat().st_size == size if path.exists() else size == 0
            replayable = (complete
                          and not flow.request.http_version.startswith('HTTP/3')
                          and flow.request.headers.get('upgrade', '').lower() != 'websocket')
            if isinstance(stream, Preview):
                stream.release_preview()
            emit({'id': flow.id, 'requestComplete': True, 'replayable': replayable,
                  'requestSize': size, 'url': flow.request.url, 'requestHeaders': headers(flow.request),
                  'requestTrailers': headers(flow.request.trailers) if flow.request.trailers else []}, flow)

    def response(self, flow):
        if flow.metadata.get('apirequest_capture'):
            if flow.response.raw_content is not None:
                # 本地规则直接生成的响应可能不经过流式回调。
                preview = Preview(flow, 'responseBody', flow.response)
                preview(flow.response.raw_content)
                preview(b'')
            if isinstance(flow.response.stream, Preview):
                flow.response.stream.release_preview()
            emit({'id': flow.id, 'responseComplete': True,
                  'elapsedMs': max(0, round((time.time() - flow.request.timestamp_start) * 1000)),
                  'responseSize': flow.response.stream.total if isinstance(flow.response.stream, Preview) else len(flow.response.raw_content or b''),
                  'timings': self.timings(flow)}, flow)
            if flow.response.status_code != 101:
                self.finish_flow(flow)

    def error(self, flow):
        if flow.metadata.get('apirequest_capture'):
            emit({'id': flow.id, 'failed': True, 'elapsedMs': max(0, round((time.time() - flow.request.timestamp_start) * 1000))}, flow)
            self.finish_flow(flow)

    def finish_flow(self, flow):
        if flow.metadata.pop('capture_archive_open', False):
            archive = flow.metadata['capture_archive']
            archive.pending -= 1
            if archive in LISTENER.retired and archive.pending == 0:
                archive.close()
                LISTENER.retired.remove(archive)

    def websocket_end(self, flow):
        self.finish_flow(flow)

    def websocket_message(self, flow):
        if not flow.metadata.get('apirequest_capture'):
            return
        message = flow.websocket.messages[-1]
        emit({'id': flow.id, 'frame': {
            'outgoing': message.from_client, 'size': len(message.content), 'timestamp': int(message.timestamp * 1000),
            'text': message.content.decode('utf-8', 'replace') if message.is_text else None,
            **({'base64': base64.b64encode(message.content).decode('ascii')} if not message.is_text else {}),
        }}, flow)
        # 保留当前消息供引擎转发，先前消息已追加磁盘，不在代理对象中累积。
        del flow.websocket.messages[:-1]

    @staticmethod
    def timing_offsets(flow):
        server, request, response = flow.server_conn, flow.request, flow.response
        start = request.timestamp_start
        def offset(value):
            return max(0, round((value - start) * 1000)) if value is not None else 0
        return dict(connect=offset(server.timestamp_start), ssl=offset(server.timestamp_tcp_setup),
                    send=0, wait=offset(request.timestamp_end),
                    receive=offset(response.timestamp_start) if response else 0)

    @staticmethod
    def timings(flow):
        server, request, response = flow.server_conn, flow.request, flow.response
        def duration(start, end):
            return max(0, round((end - start) * 1000)) if start is not None and end is not None else None
        fresh = server.timestamp_start is not None and server.timestamp_start >= request.timestamp_start
        return dict(connect=duration(server.timestamp_start, server.timestamp_tcp_setup) if fresh else None,
                    ssl=duration(server.timestamp_tcp_setup, server.timestamp_tls_setup) if fresh else None,
                    send=duration(request.timestamp_start, request.timestamp_end),
                    wait=duration(request.timestamp_end, response.timestamp_start) if response else None,
                    receive=duration(response.timestamp_start, response.timestamp_end) if response else None)


class CaptureManager:
    async def running(self):
        # 停止抓包时使用无监听、无归档的一次性进程，证书不再依赖流量会话生命周期。
        try:
            action = json.loads(os.environ['APIREQUEST_CAPTURE_MANAGE'])
            system = SystemProxy(os.environ['APIREQUEST_CAPTURE_CONFIG'], 18888)
            if action == 'system_status':
                result = await asyncio.to_thread(system.status)
                result['capabilities'] = capabilities()
            elif action == 'system_restore':
                await asyncio.to_thread(system.restore)
                result = {}
            elif action in ('certificate_status', 'certificate_install', 'certificate_remove'):
                result = {'trusted': await asyncio.to_thread(system.trust, action.removeprefix('certificate_'))}
            else:
                raise ValueError('forbidden')
            write_event({'result': result})
        except Exception as error:
            code = str(error) if isinstance(error, ValueError) else 'system_unavailable'
            write_event({'error': code})
        finally:
            ctx.master.shutdown()


addons = [CaptureManager()] if os.environ.get('APIREQUEST_CAPTURE_MANAGE') else [Recorder()]
