"""本机归档查询：流式扫描索引，正文分页读取，所有宿主复用相同隔离检查。"""
import base64
from functools import cmp_to_key
import heapq
import json
import math
from pathlib import Path
import shutil
import time
import uuid
from urllib.parse import urlsplit

from archive import Archive
from controller import valid_id


class CaptureArchiveAPI:
    def __init__(self, capture):
        self.capture = capture
        self.root = capture.root / 'sessions'
        self.root.mkdir(exist_ok=True, mode=0o700)

    def manifests(self):
        for folder in self.root.iterdir():
            if not folder.is_dir() or not valid_id(folder.name):
                continue
            try:
                item = json.loads((folder / 'session.json').read_text())
                if item.get('importing'):
                    continue
                item['active'] = item['id'] in self.active_ids()
                yield item
            except (OSError, ValueError):
                continue

    def active_ids(self):
        return {archive.id for archive in ([self.capture.archive] if self.capture.archive else []) + self.capture.retired if not archive.closed}

    def session(self, id):
        if not valid_id(id):
            raise ValueError('entry_unavailable')
        folder = self.root / id
        manifest = json.loads((folder / 'session.json').read_text())
        return folder, manifest

    def locate(self, session_id, entry_id):
        if not valid_id(entry_id):
            raise ValueError('entry_unavailable')
        if session_id == '@live':
            candidates = [self.capture.archive.id] if self.capture.archive else []
        else:
            candidates = [session_id]
        for id in candidates:
            try:
                folder, manifest = self.session(id)
                entry = json.loads((folder / entry_id / 'entry.json').read_text())
                entry.update(sessionId=id)
                return entry, folder / entry_id
            except (OSError, ValueError):
                continue
        raise ValueError('entry_unavailable')

    @staticmethod
    def matches(entry, body):
        url = urlsplit(entry.get('url', ''))
        if not ((not body.get('hosts') or url.netloc in body['hosts'])
                and (not body.get('clients') or entry.get('client') in body['clients'])
                and (not body.get('applications') or entry.get('application') in body['applications'])
                and (not body.get('search') or body['search'].lower() in f"{entry.get('method', '')} {entry.get('url', '')} {entry.get('status', '')} {entry.get('application', '')} {entry.get('processId', '')}".lower())):
            return False
        filters = body.get('filters') or {}
        for field in ('url', 'protocol', 'contentType', 'client', 'server'):
            if filters.get(field) and str(filters[field]).casefold() not in str(entry.get(field) or '').casefold():
                return False
        if filters.get('method') and entry.get('method') not in filters['method']:
            return False
        statuses = filters.get('status')
        if statuses:
            status = entry.get('status')
            groups = {str(status), f'{status // 100}xx'} if isinstance(status, int) else set()
            if entry.get('failed'):
                groups.add('failed')
            elif status is None:
                groups.add('pending')
            if not groups.intersection(statuses):
                return False
        for field in ('elapsedMs', 'responseSize'):
            bounds = filters.get(field) or {}
            if bounds.get('min') is None and bounds.get('max') is None:
                continue
            value = entry.get(field)
            if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
                return False
            if bounds.get('min') is not None and value < bounds['min']:
                return False
            if bounds.get('max') is not None and value > bounds['max']:
                return False
        return True

    @staticmethod
    def query_key(body):
        """Validate column inputs and keep missing values last in either direction."""
        filters = body.get('filters') or {}
        if not isinstance(filters, dict):
            raise ValueError('invalid_target')
        for field, value in filters.items():
            if field in ('url', 'protocol', 'contentType', 'client', 'server'):
                valid = isinstance(value, str)
            elif field in ('method', 'status'):
                valid = isinstance(value, list) and all(isinstance(item, str) for item in value)
            elif field in ('elapsedMs', 'responseSize'):
                valid = isinstance(value, dict) and all(
                    bound is None or (isinstance(bound, (int, float)) and not isinstance(bound, bool) and math.isfinite(bound) and bound >= 0)
                    for bound in (value.get('min'), value.get('max')))
                if valid and value.get('min') is not None and value.get('max') is not None:
                    valid = value['min'] <= value['max']
            else:
                valid = False
            if not valid:
                raise ValueError('invalid_target')
        sort = body.get('sort') or {}
        if not isinstance(sort, dict):
            raise ValueError('invalid_target')
        field = sort.get('field', 'sequence')
        numeric = field in ('sequence', 'startedAt', 'status', 'elapsedMs', 'responseSize')
        if not numeric and field not in ('application', 'method', 'url', 'protocol', 'contentType', 'client', 'server'):
            raise ValueError('invalid_target')
        descending = sort.get('descending', True)
        if not isinstance(descending, bool):
            raise ValueError('invalid_target')

        def compare(left, right):
            a, b = left.get(field), right.get(field)
            if numeric:
                a = a if isinstance(a, (int, float)) and not isinstance(a, bool) and math.isfinite(a) else None
                b = b if isinstance(b, (int, float)) and not isinstance(b, bool) and math.isfinite(b) else None
            else:
                a = str(a).casefold() if a is not None and a != '' else None
                b = str(b).casefold() if b is not None and b != '' else None
            if (a is None) != (b is None):
                return 1 if a is None else -1
            if a is not None and a != b:
                return ((a > b) - (a < b)) * (-1 if descending else 1)
            # Equal values stay deterministic across pages and refreshes.
            return (right['sequence'] > left['sequence']) - (right['sequence'] < left['sequence'])

        return cmp_to_key(compare)

    def command(self, action, body):
        if action == 'archive_list':
            return sorted(self.manifests(), key=lambda item: item['date'], reverse=True)
        if action == 'archive_page':
            manifests = [item for item in self.manifests() if
                         item['id'] in ({self.capture.archive.id} if self.capture.archive else set())] if body.get('session') == '@live' else [self.session(body.get('session'))[1]]
            limit = max(1, min(500, int(body.get('limit', 200))))
            offset = max(0, int(body.get('offset', 0)))
            # 分页不缓存全部流量；堆只保留这一页之前所需摘要，offset 有界防止恶意大分配。
            if offset > 100000:
                raise ValueError('invalid_target')
            key = self.query_key(body)
            total, hosts, clients, applications, methods = 0, set(), set(), set(), set()
            before = body.get('before')
            if before is None:
                before = int(time.time() * 1000)

            def matching_entries():
                nonlocal total
                for manifest in manifests:
                    folder = self.root / manifest['id']
                    with (folder / 'index.jsonl').open() as source:
                        for sequence, line in enumerate(source, 1):
                            try:
                                summary = json.loads(line)
                                entry = json.loads((folder / summary['id'] / 'summary.json').read_text())
                            except (OSError, ValueError):
                                continue
                            if entry.get('startedAt', 0) > before:
                                continue
                            if len(hosts) < 1000:
                                hosts.add(urlsplit(entry['url']).netloc)
                            for field, values in (('client', clients), ('application', applications), ('method', methods)):
                                if entry.get(field) and len(values) < 1000:
                                    values.add(entry[field])
                            if not self.matches(entry, body):
                                continue
                            total += 1
                            entry.update(sessionId=manifest['id'], sequence=sequence)
                            yield entry

            # Bounded heap: sort the entire session without loading bodies or all summaries into memory.
            selected = heapq.nsmallest(offset + limit, matching_entries(), key=key)[offset:offset + limit]
            return dict(entries=selected, total=total, hosts=sorted(hosts), clients=sorted(clients), applications=sorted(applications), methods=sorted(methods),
                        boundary=before)
        if action == 'archive_create':
            id = str(uuid.uuid4())
            folder = self.root / id
            folder.mkdir(mode=0o700)
            item = dict(id=id, name=str(body.get('name', 'HAR'))[:120], date=int(time.time() * 1000), count=0, bytes=0,
                        dropped=0, active=False)
            Archive.write_json(folder / 'session.json', item)
            (folder / 'index.jsonl').touch(mode=0o600)
            return item
        if action in ('archive_delete', 'archive_rename', 'archive_import'):
            folder, manifest = self.session(body.get('session'))
            if action == 'archive_rename':
                name = str(body.get('name', '')).strip()[:120]
                if not name:
                    raise ValueError('invalid_rules')
                # 活动会话同时更新内存与磁盘；删除、导入仍禁止触碰在写入的归档。
                archive = next((item for item in ([self.capture.archive] if self.capture.archive else []) + self.capture.retired
                                if item.id == manifest['id']), None)
                if archive:
                    archive.rename(name)
                else:
                    manifest['name'] = name
                    Archive.write_json(folder / 'session.json', manifest)
                return {}
            if manifest['id'] in self.active_ids():
                raise ValueError('busy')
            if action == 'archive_delete':
                shutil.rmtree(folder)
            else:
                entry = dict(body['entry'], replayable=False, paused=None)
                if not valid_id(entry.get('id')):
                    raise ValueError('invalid_har')
                target = folder / entry['id']
                target.mkdir(mode=0o700)
                for side in ('requestBody', 'responseBody'):
                    content = entry.get(side)
                    if content and not content.get('truncated') and (content.get('base64') or content.get('text') is not None):
                        data = base64.b64decode(content['base64']) if content.get('base64') else content['text'].encode()
                        (target / (side + '.bin')).write_bytes(data)
                        manifest['bytes'] += len(data)
                summary = {key: value for key, value in entry.items() if key not in ('requestBody', 'responseBody', 'requestHeaders', 'responseHeaders', 'frames')}
                Archive.write_json(target / 'entry.json', entry)
                Archive.write_json(target / 'summary.json', summary)
                with (folder / 'index.jsonl').open('a') as index:
                    index.write(json.dumps(summary) + '\n')
                manifest['count'] += 1
                Archive.write_json(folder / 'session.json', manifest)
            return {}
        entry, folder = self.locate(body.get('session'), body.get('id'))
        if action == 'archive_entry':
            if entry['sessionId'] not in self.active_ids():
                entry['paused'] = None
            return entry
        if action == 'archive_frames':
            offset = max(0, int(body.get('offset', 0)))
            items, index = [], 0
            path = folder / 'frames.jsonl'
            if path.exists():
                with path.open() as source:
                    for line in source:
                        index += 1
                        if index > offset:
                            items.append(json.loads(line))
                            if len(items) == 200:
                                break
            return dict(entries=items, next=index if len(items) == 200 else None)
        if action == 'archive_body':
            side = body.get('side')
            if side not in ('requestBody', 'responseBody'):
                raise ValueError('entry_unavailable')
            path = folder / (side + '.bin')
            offset = max(0, int(body.get('offset', 0)))
            with path.open('rb') as source:
                source.seek(offset)
                data = source.read(65536)
                size = path.stat().st_size
            return dict(base64=base64.b64encode(data).decode(), size=max(size, entry.get(side, {}).get('size', 0)),
                        next=offset + len(data) if offset + len(data) < size else None)
        raise ValueError('forbidden')
