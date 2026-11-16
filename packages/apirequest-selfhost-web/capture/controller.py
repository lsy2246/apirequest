"""单机抓包控制：持有一个本机入口，归档与规则不依赖设备登记。"""
import asyncio
import copy
import json
import os
from pathlib import Path
import re

from archive import Archive
from capture_modes import CaptureRuntime, capabilities, validate_options


def valid_id(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value) is not None


def private_file(path, value):
    temporary = path.with_suffix('.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as target:
        json.dump(value, target, ensure_ascii=True)
        target.flush()
        os.fsync(target.fileno())
    os.replace(temporary, path)
    os.chmod(path, 0o600)


class CaptureLock:
    def __init__(self, root):
        path = root / 'workspace.lock'
        self.file = path.open('a+b')
        try:
            if os.name == 'nt':
                import msvcrt
                if path.stat().st_size == 0:
                    self.file.write(b'0'); self.file.flush()
                self.file.seek(0)
                msvcrt.locking(self.file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.file.close()
            raise ValueError('busy') from None

    def close(self):
        self.file.close()


class CaptureController:
    mode = 'control'
    endpoint = None

    def __init__(self, manager, root, hosts, ports, session, port, on_change=None):
        self.on_change = on_change or (lambda: None)
        self.manager, self.root, self.session = manager, Path(root), session
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.file_lock = CaptureLock(self.root)
        self.path = self.root / 'capture.json'
        self.config = json.loads(self.path.read_text()) if self.path.exists() else {
            'revision': 0, 'mode': 'system', 'systemProxy': getattr(session.system, 'os', None) in ('Darwin', 'Windows'), 'service': '', 'rules': []}
        validate_options({'mode': self.config['mode']})
        self.hosts, self.ports, self.port = hosts, ports, port
        self.runtime, self.archive = None, None
        self.retired = []
        self.recording, self.closed = False, False
        self.lock = asyncio.Lock()
        from archive_api import CaptureArchiveAPI
        self.archive_api = CaptureArchiveAPI(self)

    async def start(self):
        # 控制口就绪不等于开始捕获；只恢复本应用异常退出时持有的代理快照。
        if self.session.system.snapshot.exists():
            await asyncio.to_thread(self.session.system.restore)

    def allowed(self, host, port):
        return self.runtime is not None and self.runtime.allowed(host, port)

    async def allowed_connection(self, address):
        return self.runtime is not None and await self.runtime.allowed_connection(address)

    def save(self, values):
        next_config = dict(values, revision=self.config['revision'] + 1)
        private_file(self.path, next_config)
        self.config = next_config

    def status(self):
        current = self.archive
        return dict(state='running' if self.runtime else 'stopped', recording=self.recording,
                    mode=self.config['mode'], systemProxy=self.config['systemProxy'], service=self.config['service'],
                    revision=self.config['revision'], capabilities=capabilities(),
                    server=os.environ.get('APIREQUEST_CAPTURE_SERVER') == 'true',
                    archiveID=current.id if current else '', error='',
                    proxy=f'http://127.0.0.1:{self.port}' if self.config['mode'] == 'system' else '',
                    endpoint=self.runtime.endpoint if self.runtime else '',
                    archiveStatus={'dropped': sum(item.manifest['dropped'] for item in ([current] if current else []) + self.retired)})

    async def start_capture(self):
        runtime = CaptureRuntime(self.manager, self.root, {'mode': self.config['mode']},
                                 '127.0.0.1', self.port, '', self.hosts, self.ports)
        try:
            self.session.startup_task = asyncio.create_task(runtime.start())
            await self.session.startup_task
            self.session.startup_task = None
            self.runtime = runtime
            if runtime.mode == 'system' and self.config['systemProxy']:
                await asyncio.to_thread(self.session.system.enable, self.config['service'])
        except BaseException as failure:
            self.session.startup_task = None
            self.runtime = None
            await runtime.close()
            await asyncio.to_thread(self.session.system.restore)
            if isinstance(failure, Exception) and not isinstance(failure, ValueError):
                raise ValueError('local_start_failed' if runtime.mode == 'local' else 'system_unavailable') from None
            raise
        self.runtime = runtime

    async def stop_capture(self):
        self.recording = False
        self.session.clear(resume=True)
        await self.session.stop_replay()
        runtime, self.runtime = self.runtime, None
        try:
            if runtime:
                await runtime.close()
        finally:
            await asyncio.to_thread(self.session.system.restore)

    def new_archive(self):
        previous = self.archive
        self.archive = Archive(self.root, self.on_change)
        if previous:
            # 新请求写新会话；仍在传输的请求继续持有旧归档，完成后才关闭。
            if getattr(previous, 'pending', 0):
                self.retired.append(previous)
            else:
                previous.close()

    async def api(self, action, body):
        result = await self._api(action, body)
        if action in ('record', 'stop', 'capture_settings', 'new_session', 'configure', 'resume', 'clear', 'replay', 'archive_delete', 'archive_rename', 'data_import'):
            self.on_change()
        return result

    async def _api(self, action, body):
        if not isinstance(action, str) or not isinstance(body, dict):
            raise ValueError('invalid_target')
        async with self.lock:
            if self.closed:
                raise ValueError('engine_unavailable')
            if action == 'status':
                return self.status()
            if action == 'capture_settings':
                if set(body) - {'revision', 'mode', 'systemProxy', 'service'}:
                    raise ValueError('invalid_target')
                if body.get('revision') != self.config['revision']:
                    raise ValueError('revision_conflict')
                mode = validate_options({'mode': body.get('mode')})['mode']
                if type(body.get('systemProxy')) is not bool or not isinstance(body.get('service', ''), str):
                    raise ValueError('invalid_target')
                if self.recording:
                    raise ValueError('busy')
                # 切换入口前完整关闭本次连接并恢复代理；不改变已保存的会话和证书。
                await self.stop_capture()
                self.save(dict(self.config, mode=mode, systemProxy=body['systemProxy'], service=body.get('service', '')))
                return self.status()
            if action == 'record':
                if type(body.get('recording')) is not bool:
                    raise ValueError('invalid_target')
                if body['recording']:
                    if self.runtime is None:
                        await self.start_capture()
                    try:
                        if self.archive is None:
                            self.new_archive()
                    except BaseException:
                        await self.stop_capture()
                        raise
                else:
                    # 暂停必须释放流量入口；只关闭归档开关会继续替换整机 HTTPS 证书。
                    # 保留 archive，继续记录时重新建立入口并写入同一会话。
                    await self.stop_capture()
                self.recording = body['recording']
                return self.status()
            if action == 'new_session':
                if self.archive is None:
                    raise ValueError('engine_unavailable')
                self.new_archive()
                return self.status()
            if action == 'stop':
                await self.stop_capture()
                return self.status()
            if action == 'configure':
                if body.get('revision') != self.config['revision']:
                    raise ValueError('revision_conflict')
                previous = self.session.rules
                self.session.configure({'rules': body.get('rules', [])})
                try:
                    self.save(dict(self.config, rules=copy.deepcopy(self.session.rules)))
                except BaseException:
                    self.session.rules = previous
                    raise
                return {'revision': self.config['revision']}
            if action == 'session_status':
                return dict(rules=self.config['rules'], revision=self.config['revision'],
                            archive=self.status()['archiveStatus'], replayError=self.session.replay_error)
            if action == 'connection_info':
                return self.runtime.info() if self.runtime else {'mode': self.config['mode']}
            if action in ('system_status', 'system_restore', 'certificate_status', 'certificate_install', 'certificate_remove'):
                # 公网管理页面只提供证书下载，不允许远程修改服务机器的系统信任。
                if os.environ.get('APIREQUEST_CAPTURE_SERVER') == 'true' and action in ('certificate_install', 'certificate_remove'):
                    raise ValueError('forbidden')
                return await asyncio.to_thread(self.session.system_command, action, body)
            if action == 'resume':
                self.session.resume(body)
                return {}
            if action == 'clear':
                self.session.clear(resume=True)
                return {}
            if action == 'replay':
                if self.runtime is None or not self.recording:
                    raise ValueError('engine_unavailable')
                if self.session.replay_task and not self.session.replay_task.done():
                    raise ValueError('busy')
                ids = body.get('ids')
                if not isinstance(ids, list) or not ids or any(not valid_id(id) for id in ids) or len(set(ids)) != len(ids):
                    raise ValueError('entry_unavailable')
                session = body.get('session')
                for id in ids:
                    self.session.read_request(session, id)
                self.session.replay_error = ''
                self.session.replay_task = asyncio.create_task(self.session.replay_requests(session, ids))
                return {'accepted': len(ids)}
            if action in ('data_export', 'data_import'):
                from portable import export_data, import_data
                if action == 'data_export':
                    return await asyncio.to_thread(export_data, self)
                return await asyncio.to_thread(import_data, self, body.get('entries'), body.get('dryRun', False))
            if action.startswith('archive_'):
                # 历史扫描离开事件循环，不能因查看旧会话阻塞转发。
                try:
                    return await asyncio.to_thread(self.archive_api.command, action, body)
                except FileNotFoundError:
                    raise ValueError('entry_unavailable') from None
            raise ValueError('forbidden')

    def stop(self):
        self.closed = True
        if self.runtime:
            self.runtime.stop()

    async def close(self):
        startup = getattr(self.session, 'startup_task', None)
        if startup and not startup.done():
            startup.cancel()
        async with self.lock:
            self.closed = True
            try:
                try:
                    await self.stop_capture()
                finally:
                    for archive in ([self.archive] if self.archive else []) + self.retired:
                        archive.close()
            finally:
                self.file_lock.close()
