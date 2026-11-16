"""Portable, bounded capture archives. Never transfer host certificates or proxy state."""
import base64
import copy
import json
import os
import shutil
import tempfile
from pathlib import Path

from archive import Archive, SUMMARY
from controller import valid_id

LIMIT = 64 * 1024 * 1024


def export_data(capture):
    items = [dict(id='capture:rules', kind='capture', name='抓包规则',
                  data=dict(rules=copy.deepcopy(capture.config['rules'])), dependencies=[], omitted=[])]
    size = 0
    for manifest in sorted(capture.archive_api.manifests(), key=lambda item: item['id']):
        # A session still receiving bytes is not a stable export/sync source.
        if manifest['active']:
            continue
        root = capture.archive_api.root / manifest['id']
        entries = []
        for folder in sorted(root.iterdir()):
            if not folder.is_dir() or not valid_id(folder.name):
                continue
            entry = json.loads((folder / 'entry.json').read_text())
            entry.pop('sessionId', None)
            entry.pop('_indexed', None)
            entry.update(paused=None, replayable=False)
            files = {}
            for side in ('requestBody', 'responseBody'):
                path = folder / (side + '.bin')
                if path.exists():
                    size += path.stat().st_size
                    if size > LIMIT:
                        raise ValueError('transfer_too_large')
                    files[side] = dict(name=side + '.bin', contentType='application/octet-stream',
                                       data=base64.b64encode(path.read_bytes()).decode())
            frames = folder / 'frames.jsonl'
            if frames.exists():
                entry['frames'] = [json.loads(line) for line in frames.read_text().splitlines() if line]
            entries.append(dict(entry=entry, files=files))
        data = dict(session={key: manifest[key] for key in ('id', 'name', 'date', 'dropped')}, entries=entries)
        item = dict(id='capture:session-' + manifest['id'], kind='capture', name=manifest['name'],
                    data=data, dependencies=[], omitted=[])
        size += len(json.dumps(item).encode())
        if size > LIMIT:
            raise ValueError('transfer_too_large')
        items.append(item)
    return items


def import_data(capture, items, dry_run=False):
    if not isinstance(items, list) or len(items) > 20000 or len(json.dumps(items).encode()) > LIMIT:
        raise ValueError('invalid_target')
    rules = None
    sessions, seen = [], set()
    for item in items:
        if not isinstance(item, dict) or item.get('kind') != 'capture' or item.get('id') in seen:
            raise ValueError('invalid_target')
        seen.add(item.get('id'))
        data = item.get('data', {})
        if item['id'] == 'capture:rules':
            previous = copy.deepcopy(capture.session.rules)
            try:
                capture.session.configure({'rules': data.get('rules')})
                rules = copy.deepcopy(capture.session.rules)
            finally:
                capture.session.rules = previous
            continue
        session = data.get('session', {})
        id = session.get('id')
        if not valid_id(id) or item['id'] != 'capture:session-' + id or not isinstance(session.get('name'), str):
            raise ValueError('invalid_target')
        if id in capture.archive_api.active_ids():
            raise ValueError('busy')
        entries, ids = [], set()
        if not isinstance(data.get('entries'), list):
            raise ValueError('invalid_target')
        for value in data['entries']:
            entry = copy.deepcopy(value['entry'])
            eid = entry.get('id')
            if not valid_id(eid) or eid in ids or not isinstance(entry.get('url'), str) or not isinstance(entry.get('startedAt'), (int, float)):
                raise ValueError('invalid_target')
            ids.add(eid)
            files = {}
            for side, file in value.get('files', {}).items():
                if side not in ('requestBody', 'responseBody') or not isinstance(file.get('data'), str):
                    raise ValueError('invalid_target')
                files[side] = base64.b64decode(file['data'], validate=True)
            for key in ('requestHeaders', 'responseHeaders', 'requestTrailers'):
                if key in entry and (not isinstance(entry[key], list) or any(not isinstance(pair, list) or len(pair) != 2 or any(not isinstance(v, str) for v in pair) for pair in entry[key])):
                    raise ValueError('invalid_target')
            if not isinstance(entry.get('frames', []), list):
                raise ValueError('invalid_target')
            entry.update(paused=None, replayable=False, _indexed=True)
            entry.pop('sessionId', None)
            entries.append((entry, files))
        sessions.append((dict(id=id, name=session['name'][:120], date=session.get('date', 0),
                              dropped=session.get('dropped', 0), active=False, count=len(entries),
                              bytes=sum(len(body) for _, files in entries for body in files.values())), entries))
    if dry_run:
        return {}
    # Stage the complete batch before replacing a single existing archive.
    staging = Path(tempfile.mkdtemp(prefix='.transfer-', dir=capture.root))
    replaced, published = [], []
    try:
        for manifest, entries in sessions:
            folder = staging / manifest['id']; folder.mkdir(mode=0o700)
            Archive.write_json(folder / 'session.json', manifest)
            with (folder / 'index.jsonl').open('w') as index:
                for entry, files in entries:
                    target = folder / entry['id']; target.mkdir(mode=0o700)
                    frames = entry.pop('frames', [])
                    Archive.write_json(target / 'entry.json', entry)
                    summary = {key: entry[key] for key in SUMMARY if key in entry}
                    Archive.write_json(target / 'summary.json', summary)
                    index.write(json.dumps(summary) + '\n')
                    for side, body in files.items():
                        (target / (side + '.bin')).write_bytes(body)
                    if frames:
                        (target / 'frames.jsonl').write_text(''.join(json.dumps(frame) + '\n' for frame in frames))
        for manifest, _ in sessions:
            id = manifest['id']; target = capture.archive_api.root / id
            if target.exists():
                backup = staging / ('backup-' + id)
                os.replace(target, backup); replaced.append((target, backup))
            os.replace(staging / id, target); published.append(target)
        if rules is not None:
            capture.save(dict(capture.config, rules=rules))
            capture.session.rules = rules
    except BaseException:
        for target in reversed(published):
            shutil.rmtree(target)
        for target, backup in reversed(replaced):
            os.replace(backup, target)
        raise
    finally:
        shutil.rmtree(staging)
    return {}
