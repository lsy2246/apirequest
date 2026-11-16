"""根据机器内存自动分配临时缓冲；不限制磁盘记录条数或正文大小。"""
import os


def memory_budget():
    try:
        physical = os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')
    except (AttributeError, ValueError, OSError):
        physical = 8 * 1024**3
    return max(16 * 1024**2, min(128 * 1024**2, physical // 256))


# 仅保护正文预览缓冲；正文由归档器直接写盘，没有待写盘队列。
MEMORY_BUDGET = memory_budget()
IO_CHUNK = 64 * 1024
PREVIEW_WINDOW = max(IO_CHUNK, MEMORY_BUDGET // 64)


class PreviewMemory:
    def __init__(self):
        self.used = 0
        self.capacity = MEMORY_BUDGET // 4

    def take(self, count):
        granted = max(0, min(count, self.capacity - self.used))
        self.used += granted
        return granted

    def release(self, count):
        self.used = max(0, self.used - count)


PREVIEWS = PreviewMemory()
