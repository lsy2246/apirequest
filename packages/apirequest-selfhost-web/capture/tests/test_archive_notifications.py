import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from archive import Archive


class ArchiveNotifications(unittest.TestCase):
    def test_notification_follows_committed_summary_and_body(self):
        with tempfile.TemporaryDirectory() as directory:
            observed = []
            archive = Archive(directory)

            def changed():
                folder = archive.root / 'request'
                summary = json.loads((folder / 'summary.json').read_text())
                body = folder / 'responseBody.bin'
                observed.append((summary['url'], body.read_bytes() if body.exists() else b''))

            archive.on_change = changed
            archive.submit('event', 'request', {'url': 'http://example.test/', 'method': 'GET'})
            archive.submit('responseBody', 'request', b'first')
            archive.submit('responseBody', 'request', b'second')
            self.assertEqual(observed, [('http://example.test/', b''), ('http://example.test/', b'first'), ('http://example.test/', b'firstsecond')])
            archive.close()
            archive.submit('responseBody', 'request', b'closed')
            self.assertEqual(len(observed), 3)
