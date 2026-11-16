"""Capture transfer round trips without a running proxy or system changes."""
import base64
import copy
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
boundary = ModuleType('controller')
boundary.valid_id = lambda value: isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value) is not None
with patch.dict(sys.modules, {'controller': boundary}):
    from archive_api import CaptureArchiveAPI
    import portable
    from portable import export_data, import_data


class Portable(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.capture = SimpleNamespace(root=Path(self.temp.name), archive=None, retired=[], config={'rules': []})
        self.capture.session = SimpleNamespace(rules=[])
        self.capture.session.configure = lambda body: setattr(self.capture.session, 'rules', body['rules'])
        self.capture.save = lambda values: setattr(self.capture, 'config', values)
        self.capture.archive_api = CaptureArchiveAPI(self.capture)
        self.payload = [dict(id='capture:session-session-a', kind='capture', name='测试会话', data=dict(
            session=dict(id='session-a', name='测试会话', date=1234, dropped=0),
            entries=[dict(entry=dict(id='request-a', url='https://example.test/upload', method='POST', startedAt=100,
                                    requestHeaders=[['Accept', '*/*']], responseHeaders=[], requestComplete=True,
                                    responseComplete=True, frames=[dict(outgoing=True, text='ping', size=4)]),
                          files=dict(responseBody=dict(name='responseBody.bin', contentType='application/octet-stream',
                                                       data=base64.b64encode(b'\x00\xffbinary').decode())))]))]

    def tearDown(self):
        self.temp.cleanup()

    def test_binary_and_frames_roundtrip_is_idempotent(self):
        import_data(self.capture, self.payload)
        first = export_data(self.capture)
        self.assertEqual(first[1]['data']['entries'][0]['files']['responseBody']['data'], self.payload[0]['data']['entries'][0]['files']['responseBody']['data'])
        self.assertEqual(first[1]['data']['entries'][0]['entry']['frames'][0]['text'], 'ping')
        import_data(self.capture, first)
        self.assertEqual(export_data(self.capture), first)
        self.assertEqual(len(list(self.capture.archive_api.manifests())), 1)

    def test_request_sequences_survive_filtering_paging_and_reopen(self):
        payload = copy.deepcopy(self.payload)
        sample = payload[0]['data']['entries'][0]
        payload[0]['data']['entries'] = []
        for index in range(5):
            item = copy.deepcopy(sample)
            item['entry'].update(id=f'request-{index}', startedAt=index,
                                 url=f'https://example.test/{"keep" if index % 2 == 0 else "other"}/{index}')
            payload[0]['data']['entries'].append(item)
        import_data(self.capture, payload)
        query = dict(session='session-a', search='/keep/', limit=1)
        first = self.capture.archive_api.command('archive_page', query)
        self.assertEqual(first['total'], 3)
        self.assertEqual(first['entries'][0]['sequence'], 5)
        second = self.capture.archive_api.command('archive_page', dict(query, offset=1))
        self.assertEqual(second['entries'][0]['sequence'], 3)
        reopened = CaptureArchiveAPI(self.capture)
        page = reopened.command('archive_page', dict(session='session-a'))
        self.assertEqual([entry['sequence'] for entry in page['entries']], [5, 4, 3, 2, 1])
        # Appending a request keeps the previous requests' numbers and gives the new one the next number.
        entry = dict(sample['entry'], id='new-request', startedAt=6, url='https://example.test/new')
        reopened.command('archive_import', dict(session='session-a', entry=entry))
        page = reopened.command('archive_page', dict(session='session-a'))
        self.assertEqual([entry['sequence'] for entry in page['entries']], [6, 5, 4, 3, 2, 1])

    def test_dry_run_leaves_disk_unchanged(self):
        import_data(self.capture, self.payload, True)
        self.assertEqual(list(self.capture.archive_api.manifests()), [])

    def test_column_queries_sort_the_whole_session_before_paging(self):
        payload = copy.deepcopy(self.payload)
        payload[0]['data']['entries'] = [dict(entry=dict(
            id=f'request-{index}', url=f'https://example.test/items/{index}',
            method='GET' if index % 2 == 0 else 'POST', startedAt=index,
            application='Browser' if index % 3 == 0 else 'Terminal',
            status=200 if index % 4 == 0 else 404,
            elapsedMs=index, responseSize=index * 1024,
            requestHeaders=[], responseHeaders=[]), files={}) for index in range(305)]
        import_data(self.capture, payload)
        api = self.capture.archive_api
        query = dict(session='session-a', limit=200, sort=dict(field='elapsedMs', descending=False))
        first = api.command('archive_page', query)
        second = api.command('archive_page', dict(query, offset=200, before=first['boundary']))
        self.assertEqual(first['total'], 305)
        self.assertEqual([entry['elapsedMs'] for entry in first['entries'] + second['entries']], list(range(305)))
        # The fastest request is outside the old newest-200 page.
        self.assertEqual(first['entries'][0]['sequence'], 1)
        result = api.command('archive_page', dict(query, applications=['Browser'], filters=dict(
            method=['GET', 'POST'], status=['2xx', '500'], url='/items/',
            elapsedMs=dict(min=100, max=200), responseSize=dict(max=160 * 1024))))
        self.assertEqual([entry['elapsedMs'] for entry in result['entries']], [108, 120, 132, 144, 156])
        self.assertEqual(result['applications'], ['Browser', 'Terminal'])
        self.assertEqual(result['methods'], ['GET', 'POST'])
        # A live summary update must win over its stale index record.
        folder = api.root / 'session-a' / 'request-304'
        summary = json.loads((folder / 'summary.json').read_text())
        summary['elapsedMs'] = 9999
        (folder / 'summary.json').write_text(json.dumps(summary))
        result = api.command('archive_page', dict(query, sort=dict(field='elapsedMs', descending=True), limit=1))
        self.assertEqual(result['entries'][0]['elapsedMs'], 9999)
        # Appends newer than a saved page boundary do not move older pages.
        api.command('archive_import', dict(session='session-a', entry=dict(
            id='later', url='https://example.test/later', method='GET',
            startedAt=first['boundary'] + 1000, elapsedMs=0)))
        pinned = api.command('archive_page', dict(query, offset=200, before=first['boundary']))
        self.assertEqual(pinned['total'], 305)

    def test_status_groups_missing_values_and_invalid_ranges(self):
        payload = copy.deepcopy(self.payload)
        payload[0]['data']['entries'] = [dict(entry=dict(
            id=f'request-{index}', url='https://example.test/items', method='GET',
            startedAt=index, **values), files={}) for index, values in enumerate([
                dict(status=101, elapsedMs=20), dict(status=200, elapsedMs=0),
                dict(status=404, elapsedMs=10), dict(failed=True), dict(),
            ])]
        import_data(self.capture, payload)
        api = self.capture.archive_api
        query = dict(session='session-a')
        for status, expected in [('1xx', ['request-0']), ('200', ['request-1']),
                                 ('failed', ['request-3']), ('pending', ['request-4'])]:
            result = api.command('archive_page', dict(query, filters=dict(status=[status])))
            self.assertEqual([entry['id'] for entry in result['entries']], expected)
        result = api.command('archive_page', dict(query, filters=dict(elapsedMs=dict(max=0))))
        self.assertEqual([entry['id'] for entry in result['entries']], ['request-1'])
        for descending, expected in [(False, [0, 10, 20, None, None]), (True, [20, 10, 0, None, None])]:
            result = api.command('archive_page', dict(query, sort=dict(field='elapsedMs', descending=descending)))
            self.assertEqual([entry.get('elapsedMs') for entry in result['entries']], expected)
        for filters in [dict(elapsedMs=dict(min=10, max=1)), dict(responseSize=dict(min=-1)),
                        dict(method='GET'), dict(elapsedMs=dict(min=float('nan')))]:
            with self.assertRaisesRegex(ValueError, 'invalid_target'):
                api.command('archive_page', dict(query, filters=filters))

    def test_invalid_batch_cannot_replace_existing_archive(self):
        import_data(self.capture, self.payload)
        before = export_data(self.capture)
        invalid = copy.deepcopy(self.payload[0]); invalid['id'] = 'capture:session-../outside'; invalid['data']['session']['id'] = '../outside'
        changed = copy.deepcopy(self.payload); changed[0]['data']['session']['name'] = 'changed'
        with self.assertRaises(ValueError):
            import_data(self.capture, changed + [invalid])
        self.assertEqual(export_data(self.capture), before)

    def test_active_session_is_excluded_and_cannot_be_overwritten(self):
        import_data(self.capture, self.payload)
        self.capture.archive = SimpleNamespace(id='session-a', closed=False)
        self.assertEqual(len(export_data(self.capture)), 1)
        with self.assertRaisesRegex(ValueError, 'busy'):
            import_data(self.capture, self.payload)

    def test_failed_publish_rolls_back_every_session(self):
        import_data(self.capture, self.payload)
        before = export_data(self.capture)
        changed = copy.deepcopy(self.payload); changed[0]['data']['session']['name'] = 'changed'
        import os
        replace = os.replace
        def fail_publish(source, target):
            if Path(source).name == 'session-a' and Path(source).parent.name.startswith('.transfer-'):
                raise OSError('disk failure')
            return replace(source, target)
        with patch.object(portable.os, 'replace', side_effect=fail_publish):
            with self.assertRaises(OSError):
                import_data(self.capture, changed)
        self.assertEqual(export_data(self.capture), before)

if __name__ == '__main__':
    unittest.main()
