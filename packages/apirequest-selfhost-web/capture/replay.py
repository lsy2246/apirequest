"""锁定 mitmproxy 12.3 的单请求重放适配，保留单请求取消后的连接回收。"""
import asyncio

from mitmproxy import ctx
from mitmproxy.addons.clientplayback import ReplayHandler


async def replay_flow(flow):
    # 使用独立处理器使每次重放都可以取消，避免混入上游常驻全局队列。
    # 本适配只创建一次请求处理器，协议、TLS 与生命周期钩子仍由同版本引擎执行。
    flow.is_replay = 'request'
    handler = ReplayHandler(flow, ctx.options)
    try:
        await asyncio.wait_for(handler.replay(), 120)
    finally:
        # 只关闭此处理器创建的传输；停止抓包和取消批量重放都能立即收回在途连接。
        tasks = [transport.handler for transport in handler.transports.values() if transport.handler]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
