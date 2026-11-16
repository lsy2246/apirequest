"""流量归档：每个数据块直接写盘，不维护待写盘队列或内存积压预算。"""
import json
import os
from pathlib import Path
import threading
import time
import uuid

SUMMARY = ('application', 'processId', 'sessionId', 'id', 'method', 'url', 'protocol', 'startedAt', 'status', 'firstByteMs',
           'elapsedMs', 'failed', 'contentType', 'requestSize', 'responseSize', 'client', 'server', 'paused', 'replayable', 'originalRequest')


class Archive:
    def __init__(self, root, on_change=None):
        self.on_change = on_change
        self.id = str(uuid.uuid4())
        self.root = Path(root) / 'sessions' / self.id
        self.root.mkdir(parents=True, mode=0o700)
        self.manifest = dict(id=self.id, name=time.strftime('%Y-%m-%d %H:%M:%S'),
                             date=int(time.time() * 1000), count=0, dropped=0, bytes=0, active=True)
        # 归档调用返回前完成写入；磁盘速度直接形成背压，不转成无界内存或队列满丢弃。
        # 锁只协调写入、状态读取和关闭，没有后台写入线程或待处理任务。
        self.lock = threading.RLock()
        self.closed = False
        self.write_json(self.root / 'session.json', self.manifest)
        (self.root / 'index.jsonl').touch(mode=0o600)

    @staticmethod
    def write_json(path, value):
        temporary = path.with_suffix('.tmp')
        with temporary.open('w', encoding='utf8') as file:
            json.dump(value, file, ensure_ascii=True, separators=(',', ':'))
        os.replace(temporary, path)

    def submit(self, kind, id, value):
        with self.lock:
            if self.closed:
                return
            try:
                folder = self.root / id
                folder.mkdir(exist_ok=True, mode=0o700)
                if kind in ('requestBody', 'responseBody'):
                    with (folder / (kind + '.bin')).open('ab') as body:
                        body.write(value)
                    self.manifest['bytes'] += len(value)
                else:
                    path = folder / 'entry.json'
                    entry = json.loads(path.read_text()) if path.exists() else {'id': id}
                    value = dict(value)
                    frame = value.pop('frame', None)
                    if frame:
                        # 全量帧追加磁盘；详情只保存总数，代理对象不累积整个消息列表。
                        with (folder / 'frames.jsonl').open('a') as frames:
                            frames.write(json.dumps(frame) + '\n')
                        entry['frameCount'] = entry.get('frameCount', 0) + 1
                    entry.update(value)
                    # 详情先发布，索引后发布，实时读取不会看到缺少详情文件的新记录。
                    newly_indexed = 'url' in entry and not entry.get('_indexed')
                    if newly_indexed:
                        entry['_indexed'] = True
                    self.write_json(path, entry)
                    summary = {key: entry[key] for key in SUMMARY if key in entry}
                    self.write_json(folder / 'summary.json', summary)
                    if newly_indexed:
                        with (self.root / 'index.jsonl').open('a') as index:
                            index.write(json.dumps(summary) + '\n')
                        self.manifest['count'] += 1
                self.write_json(self.root / 'session.json', self.manifest)
            except (OSError, ValueError):
                # 实际磁盘错误仍必须报告；一次写入失败不伪装为完整记录，后续块继续尝试。
                self.manifest['dropped'] += 1
                try:
                    self.write_json(self.root / 'session.json', self.manifest)
                except OSError:
                    pass

        if self.on_change:
            self.on_change()

    def rename(self, name):
        # 名称和请求计数共用一份清单；与正文写入、关闭使用同一把锁，防止旧名称覆盖改名。
        with self.lock:
            manifest = dict(self.manifest, name=name)
            self.write_json(self.root / 'session.json', manifest)
            self.manifest['name'] = name

    def status(self):
        with self.lock:
            return dict(self.manifest)

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            # submit 已逐块完成写入，关闭无需排空队列，仅收尾尚未完成的请求状态。
            for folder in self.root.iterdir():
                path = folder / 'entry.json'
                if not folder.is_dir() or not path.exists():
                    continue
                try:
                    entry = json.loads(path.read_text())
                    if not entry.get('responseComplete') and not entry.get('failed') and 'url' in entry:
                        entry.update(_indexed=True, failed=True, interrupted=True)
                        for side, complete in (('requestBody', 'requestComplete'), ('responseBody', 'responseComplete')):
                            if isinstance(entry.get(side), dict) and not entry.get(complete):
                                entry[side]['truncated'] = True
                        self.write_json(path, entry)
                        self.write_json(folder / 'summary.json', {key: entry[key] for key in SUMMARY if key in entry})
                except (OSError, ValueError):
                    self.manifest['dropped'] += 1
            self.manifest['active'] = False
            try:
                self.write_json(self.root / 'session.json', self.manifest)
            except OSError:
                pass
