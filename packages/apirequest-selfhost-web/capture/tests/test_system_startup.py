"""单机控制的启动、取消与关闭边界；系统配置使用替身，不修改本机设置。"""
import asyncio
import importlib.util
from pathlib import Path
import sys
import tempfile
from types import ModuleType
import unittest
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
boundary = ModuleType('capture_modes')
boundary.CaptureRuntime = Mock()
boundary.capabilities = lambda: {'local': True}
boundary.validate_options = lambda options: options
with patch.dict(sys.modules, {'capture_modes': boundary}):
    spec = importlib.util.spec_from_file_location('single_capture_controller_test', ROOT / 'controller.py')
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class Startup(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.session = Mock(startup_task=None, rules=[], stop_replay=AsyncMock())
        self.session.system.os = 'Darwin'
        self.session.system.snapshot.exists.return_value = False
        self.runtime = Mock(start=AsyncMock(), close=AsyncMock(), mode='system', endpoint='http://127.0.0.1:18888')
        self.patch = patch.object(module, 'CaptureRuntime', return_value=self.runtime); self.patch.start()
        # 归档模块仅需标识符校验；注入同一模块以避免测试加载原生网络库。
        with patch.dict(sys.modules, {'controller': module}):
            self.capture = module.CaptureController(Mock(), self.directory.name, [], [], self.session, 18888)

    async def asyncTearDown(self):
        if not self.capture.closed:
            await self.capture.close()
        self.patch.stop(); self.directory.cleanup()

    async def test_ready_does_not_start_capture_or_modify_proxy(self):
        await self.capture.start()
        self.runtime.start.assert_not_awaited()
        self.session.system.enable.assert_not_called()
        self.assertEqual(self.capture.status()['state'], 'stopped')

    async def test_pause_releases_interception_and_resume_keeps_the_archive(self):
        state = await self.capture.api('record', {'recording': True})
        self.assertTrue(state['recording'])
        self.session.system.enable.assert_called_once_with('')
        first = self.capture.archive
        state = await self.capture.api('record', {'recording': False})
        self.assertEqual(state['state'], 'stopped')
        self.assertFalse(state['recording'])
        self.assertEqual(state['endpoint'], '')
        self.assertIsNone(self.capture.runtime)
        self.runtime.close.assert_awaited_once()
        self.session.system.restore.assert_called_once()
        self.session.stop_replay.assert_awaited_once()
        await self.capture.api('record', {'recording': True})
        self.assertIs(self.capture.archive, first)
        self.assertEqual(self.runtime.start.await_count, 2)

    async def test_local_pause_closes_redirector_without_enabling_system_proxy(self):
        self.runtime.mode = 'local'
        self.capture.config['mode'] = 'local'
        await self.capture.api('record', {'recording': True})
        await self.capture.api('record', {'recording': False})
        await self.capture.api('record', {'recording': False})
        self.runtime.close.assert_awaited_once()
        self.session.system.enable.assert_not_called()
        self.assertIsNone(self.capture.runtime)
        self.assertFalse(self.capture.recording)

    async def test_takeover_failure_closes_listener_and_restores_proxy(self):
        self.session.system.enable.side_effect = ValueError('existing_pac')
        with self.assertRaisesRegex(ValueError, 'existing_pac'):
            await self.capture.api('record', {'recording': True})
        self.runtime.close.assert_awaited_once()
        self.session.system.restore.assert_called_once()
        self.assertIsNone(self.capture.runtime)
        self.assertIsNone(self.capture.archive)

    async def test_stop_cancels_pending_native_authorization(self):
        entered = asyncio.Event()
        async def start():
            entered.set(); await asyncio.Event().wait()
        self.runtime.start.side_effect = start
        command = asyncio.create_task(self.capture.api('record', {'recording': True}))
        await asyncio.wait_for(entered.wait(), 2)
        await asyncio.wait_for(self.capture.close(), 2)
        with self.assertRaises(asyncio.CancelledError):
            await command
        self.runtime.close.assert_awaited_once()
        self.session.system.enable.assert_not_called()

    async def test_settings_revision_and_recording_protection(self):
        with self.assertRaisesRegex(ValueError, 'revision_conflict'):
            await self.capture.api('capture_settings', {'revision': -1, 'mode': 'system', 'systemProxy': False})
        await self.capture.api('record', {'recording': True})
        with self.assertRaisesRegex(ValueError, 'busy'):
            await self.capture.api('capture_settings', {'revision': 0, 'mode': 'system', 'systemProxy': False})
        self.assertEqual(self.capture.config['revision'], 0)

    async def test_new_session_while_paused_keeps_existing_transfer_open(self):
        await self.capture.api('record', {'recording': True})
        previous = self.capture.archive; previous.pending = 1
        await self.capture.api('record', {'recording': False})
        await self.capture.api('new_session', {})
        self.assertIn(previous, self.capture.retired)
        self.assertFalse(previous.closed)
        self.assertNotEqual(self.capture.archive.id, previous.id)
        self.assertFalse(self.capture.recording)


if __name__ == '__main__':
    unittest.main()
