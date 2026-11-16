"""本机流量入口适配器：复用代理引擎协议处理，共享归档与规则生命周期。"""
import asyncio
import ipaddress
import json
import os
from pathlib import Path
import re
import socket

import mitmproxy_rs
from mitmproxy.proxy.mode_servers import ServerInstance
from proxy_listener import ProxyListener
from capture_context import CURRENT_CONNECTION


def application_info(stream):
    # 只使用原生本机重定向器提供的进程信息，不从业务标头猜测远程设备的应用。
    # 进程归属只用于展示；平台缺少元数据时不能影响原有转发和连接清理。
    try:
        name = stream.get_extra_info('process_name')
        pid = stream.get_extra_info('pid')
    except (AttributeError, KeyError, ValueError, OSError, TypeError):
        return {}
    info = {'processId': pid} if type(pid) is int and pid > 0 else {}
    if isinstance(name, str) and name.strip():
        parts = name.strip().replace('\\', '/').rstrip('/').split('/')
        bundle = next((part[:-4] for part in parts if part.lower().endswith('.app') and len(part) > 4), None)
        info['application'] = (bundle or parts[-1])[:256]
    elif info:
        info['application'] = f'PID {pid}'
    return info


def capabilities():
    try:
        reason = mitmproxy_rs.local.LocalRedirector.unavailable_reason()
    except (AttributeError, OSError):
        reason = 'unavailable'
    return dict(local=not reason)


def validate_options(options):
    if not isinstance(options, dict):
        raise ValueError('invalid_capture_mode')
    mode = options.get('mode', 'system')
    if mode not in ('system', 'local'):
        raise ValueError('invalid_capture_mode')
    processes = options.get('processes', [])
    if (not isinstance(processes, list) or any(not isinstance(item, str) or not item.strip()
            or re.search(r'[,!@\x00\r\n]', item) for item in processes)):
        raise ValueError('invalid_processes')
    if set(options) - {'mode', 'processes'}:
        raise ValueError('invalid_capture_mode')
    return dict(mode=mode, processes=[item.strip() for item in processes])


class CaptureRuntime:
    def __init__(self, manager, root, options, bind, port, peer, hosts, ports):
        self.options = validate_options(options)
        self.mode = self.options['mode']
        self.manager, self.root = manager, Path(root)
        self.policy = ProxyListener(manager, bind, port, peer, hosts, ports)
        self.hosts, self.ports = self.policy.hosts, self.policy.ports
        self.transport = None
        self.closed = False
        self.endpoint = None
        self.stream_tasks = set()

    def allowed(self, host, port):
        return self.policy.allowed(host, port)

    async def allowed_connection(self, address):
        # 本机捕获不能阻断工作台自身的连接；这部分只透传，不归档。
        return self.mode == 'local' or await self.policy.allowed_connection(address)

    def local_stream(self, callback):
        async def stream(reader, writer=None):
            task = asyncio.current_task()
            self.stream_tasks.add(task)
            identity = {}
            if self.mode == 'local':
                identity.update(application_info(writer if writer is not None else reader))
            token = CURRENT_CONNECTION.set(identity or None)
            try:
                await callback(reader, writer)
            finally:
                CURRENT_CONNECTION.reset(token)
                self.stream_tasks.discard(task)
        return stream

    async def start(self):
        if self.mode == 'system':
            await self.policy.start()
            self.endpoint = f'http://{self.policy.bind}:{self.policy.port}'
        elif self.mode == 'local':
            if not capabilities()['local']:
                raise ValueError('local_unavailable')
            excluded = json.loads(os.environ.get('APIREQUEST_CAPTURE_EXCLUDED_PIDS', '[]'))
            spec = ','.join(self.options['processes'] + [f'!{pid}' for pid in excluded if type(pid) is int and pid > 0]
                            + [f'!{os.getpid()}'])
            protocol = ServerInstance.make('local:' + spec, self.manager)
            # 使用公开的原生入口，持有并关闭本次句柄，避免上游常驻重定向器残留捕获规则。
            self.transport = await mitmproxy_rs.local.start_local_redirector(self.local_stream(protocol.handle_stream), self.local_stream(protocol.handle_stream))
            if self.closed:
                self.transport.close()
                await self.transport.wait_closed()
                raise asyncio.CancelledError()
            self.transport.set_intercept(spec)
    def info(self):
        return dict(mode=self.mode, endpoint=self.endpoint, processes=self.options['processes'])

    def stop(self):
        if self.closed:
            return
        self.closed = True
        self.policy.stop()
        for task in tuple(self.stream_tasks):
            task.cancel()
        if self.transport:
            try:
                self.transport.set_intercept('')
            finally:
                self.transport.close()

    async def close(self):
        self.stop()
        await self.policy.close()
        if self.stream_tasks:
            await asyncio.gather(*tuple(self.stream_tasks), return_exceptions=True)
        if self.transport:
            await self.transport.wait_closed()
