"""仅在本机连接任务中传递原生进程元数据，不承载设备身份。"""
from contextvars import ContextVar

CURRENT_CONNECTION = ContextVar('capture_connection', default=None)
