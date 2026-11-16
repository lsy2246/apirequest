"""归档写入、失败恢复和活动会话重命名回归；不连接用户的调试实例。"""
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

class ArchiveFailures(unittest.TestCase):
    @staticmethod
    def load_archive():
        spec=importlib.util.spec_from_file_location('capture_archive',Path(__file__).resolve().parents[1]/'archive.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module.Archive

    def test_body_is_written_before_return_without_queue_or_size_quota(self):
        with tempfile.TemporaryDirectory() as directory:
            archive=self.load_archive()(directory)
            data=b'full body' * (1024 * 1024)
            try:
                archive.submit('responseBody','entry-a',data)
                self.assertEqual((archive.root/'entry-a'/'responseBody.bin').read_bytes(),data)
                self.assertEqual(archive.status()['bytes'],len(data))
                self.assertEqual(archive.status()['dropped'],0)
                self.assertNotIn('pendingBytes',archive.status())
                self.assertFalse(hasattr(archive,'pending'))
                self.assertFalse(hasattr(archive,'thread'))
            finally:
                archive.close()

    def test_failed_disk_write_is_visible_and_later_writes_recover(self):
        with tempfile.TemporaryDirectory() as directory:
            archive=self.load_archive()(directory)
            try:
                with patch.object(archive,'write_json',side_effect=OSError('disk full')):
                    archive.submit('event','entry-a',{'id':'entry-a','begin':True})
                archive.submit('event','entry-a',{'id':'entry-a','url':'https://example.com/test','method':'GET','protocol':'HTTP/1.1','startedAt':0,'responseComplete':True})
            finally:
                archive.close()
            self.assertEqual(archive.status()['dropped'],1)
            self.assertEqual(archive.status()['count'],1)
            self.assertTrue(archive.closed)

    def test_active_archive_rename_survives_concurrent_writes_and_close(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = self.load_archive()(directory)
            def write_requests():
                for index in range(30):
                    archive.submit('event', f'entry-{index}', {'url': f'https://example.com/{index}', 'startedAt': index, 'responseComplete': True})
            writer = threading.Thread(target=write_requests)
            try:
                writer.start()
                archive.rename('自定义会话')
                writer.join(timeout=10)
                self.assertFalse(writer.is_alive())
            finally:
                writer.join()
                archive.close()
            manifest = json.loads((archive.root / 'session.json').read_text())
            self.assertEqual(manifest['name'], '自定义会话')
            self.assertEqual(manifest['count'], 30)
            self.assertFalse(manifest['active'])

    def test_rename_disk_failure_preserves_previous_name(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = self.load_archive()(directory)
            previous = archive.manifest['name']
            try:
                with patch.object(archive, 'write_json', side_effect=OSError('disk full')):
                    with self.assertRaises(OSError):
                        archive.rename('不能写入的名称')
                self.assertEqual(archive.manifest['name'], previous)
            finally:
                archive.close()
            self.assertEqual(json.loads((archive.root / 'session.json').read_text())['name'], previous)


if __name__ == '__main__':
    unittest.main()
