"""共用一个入口识别 HTTP/SOCKS5，协议解析与连接转发继续由 mitmproxy 负责。"""
import asyncio
import ipaddress
import socket
from capture_context import CURRENT_CONNECTION

from mitmproxy.proxy.mode_servers import ServerInstance


class PrefixReader:
    def __init__(self, first, reader):
        self.first, self.reader = first, reader

    async def read(self, size=-1):
        # 协议探测消耗的首字节只归还一次，不复制后续正文或更换原始客户端连接。
        if self.first:
            first, self.first = self.first, b''
            return first
        return await self.reader.read(size)


class ProxyListener:
    def __init__(self, manager, bind, port, peer, internal_hosts, internal_ports):
        self.bind, self.port, self.peer = bind, port, peer
        self.hosts = set(internal_hosts) | {'localhost', '127.0.0.1', '0.0.0.0', '::', '::1', bind}
        self.ports = set(internal_ports)
        self.protocols = {name: ServerInstance.make(name, manager) for name in ('regular', 'socks5')}
        self.server = None
        self.tasks = set()
        # 本机网卡地址用于阻止经局域网地址绕回工作台；其他本地 API 端口仍可抓取。
        try:
            self.hosts.update(item[4][0] for item in socket.getaddrinfo(socket.gethostname(), None))
        except OSError:
            pass

    def allowed(self, host, port):
        if port == self.port:
            return False
        if port not in self.ports:
            return True
        host = host.lower().rstrip('.').strip('[]')
        if host in self.hosts or host.endswith('.localhost'):
            return False
        try:
            address = ipaddress.ip_address(host)
            address = getattr(address, 'ipv4_mapped', None) or address
            return not (address.is_loopback or address.is_unspecified)
        except ValueError:
            return True

    async def allowed_connection(self, address):
        host, port = address
        if not self.allowed(host, port):
            return False
        # 仅保留端口解析别名，避免把普通远端服务的同号端口一并禁用。
        if port in self.ports:
            try:
                resolved = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
            except OSError:
                return False
            return all(self.allowed(item[4][0], port) for item in resolved)
        return True

    async def start(self):
        self.server = await asyncio.start_server(self.handle, self.bind, self.port)

    async def handle(self, reader, writer):
        task = asyncio.current_task()
        self.tasks.add(task)
        token = CURRENT_CONNECTION.set(None)
        try:
            if self.peer and writer.get_extra_info('peername')[0] != self.peer:
                return
            first = await asyncio.wait_for(reader.read(1), 10)
            if not first:
                return
            # SOCKS5 以版本字节 0x05 开头，其余连接交给标准 HTTP 代理解析器。
            protocol = self.protocols['socks5' if first.startswith(b'\x05') else 'regular']
            await protocol.handle_stream(PrefixReader(first, reader), writer)
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError):
            pass
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass
            self.tasks.discard(task)
            CURRENT_CONNECTION.reset(token)

    def stop(self):
        if self.server:
            self.server.close()
        for task in tuple(self.tasks):
            task.cancel()

    async def close(self):
        self.stop()
        if self.server:
            await self.server.wait_closed()
        if self.tasks:
            await asyncio.gather(*tuple(self.tasks), return_exceptions=True)
