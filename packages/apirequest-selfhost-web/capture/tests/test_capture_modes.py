"""入口生命周期和输入边界使用原生句柄替身，只覆盖系统代理和本机透明捕获。"""
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
from types import ModuleType
import unittest
from unittest.mock import AsyncMock, Mock, patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
native=ModuleType('mitmproxy_rs')
native.local=Mock()
modes=ModuleType('mitmproxy.proxy.mode_servers');modes.ServerInstance=Mock()
with patch.dict(sys.modules,{'mitmproxy_rs':native,'mitmproxy.proxy.mode_servers':modes}):
    spec=importlib.util.spec_from_file_location('capture_modes_test',ROOT/'capture_modes.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class Modes(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory=tempfile.TemporaryDirectory()
        self.transport=Mock(wait_closed=AsyncMock())
        self.transport.getsockname.return_value=('0.0.0.0',51820)
        native.local.LocalRedirector.unavailable_reason.return_value=None
        native.local.start_local_redirector=AsyncMock(return_value=self.transport)
        self.policy=Mock(start=AsyncMock(),close=AsyncMock(),hosts={'127.0.0.1'},ports={3001})
        self.patch=patch.object(module,'ProxyListener',return_value=self.policy);self.patch.start()

    async def asyncTearDown(self):
        self.patch.stop();self.directory.cleanup()

    def runtime(self,options):
        return module.CaptureRuntime(Mock(),self.directory.name,options,'127.0.0.1',18888,'',[],[])

    async def test_local_application_identity_and_cleanup(self):
        runtime = self.runtime({'mode': 'local'})
        stream = Mock()
        stream.get_extra_info.side_effect = {'process_name': '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'pid': 1234}.get
        received = []
        async def callback(reader, writer=None):
            received.append(dict(module.CURRENT_CONNECTION.get()))
        await runtime.local_stream(callback)(stream)
        self.assertEqual(received, [{'application': 'Google Chrome', 'processId': 1234}])
        self.assertIsNone(module.CURRENT_CONNECTION.get())
        self.assertEqual(runtime.stream_tasks, set())

    async def test_missing_application_metadata_does_not_interrupt_forwarding(self):
        runtime = self.runtime({'mode': 'local'})
        stream = Mock()
        stream.get_extra_info.side_effect = OSError('unavailable')
        callback = AsyncMock()
        await runtime.local_stream(callback)(stream)
        callback.assert_awaited_once_with(stream, None)
        self.assertIsNone(module.CURRENT_CONNECTION.get())
        self.assertEqual(runtime.stream_tasks, set())

    def test_application_name_normalization(self):
        for name, pid, expected in [
            (r'C:\Program Files\Google\Chrome\Application\chrome.exe', 12, {'application': 'chrome.exe', 'processId': 12}),
            (None, 34, {'application': 'PID 34', 'processId': 34}),
            ('', None, {}),
        ]:
            with self.subTest(name=name):
                stream = Mock()
                stream.get_extra_info.side_effect = {'process_name': name, 'pid': pid}.get
                self.assertEqual(module.application_info(stream), expected)

    async def test_local_process_filter_excludes_engine_and_stops_once(self):
        with patch.dict(os.environ,{'APIREQUEST_CAPTURE_EXCLUDED_PIDS':'[12345]'}):
            runtime=self.runtime({'mode':'local','processes':['curl','42']})
            await runtime.start()
        spec=self.transport.set_intercept.call_args.args[0]
        self.assertIn('curl,42',spec);self.assertIn('!12345',spec);self.assertIn(f'!{os.getpid()}',spec)
        await runtime.close();runtime.stop()
        self.transport.close.assert_called_once()
        self.assertEqual(self.transport.set_intercept.call_args.args[0],'')

    async def test_invalid_configuration_never_creates_native_listener(self):
        for options in [{'mode':'tun'},{'mode':'local','processes':['!other']},{'mode':'wireguard'},{'wireguardPort':True},{'wireguardPort':0}]:
            with self.assertRaises(ValueError):self.runtime(options)

    async def test_native_start_failure_propagates_without_enabling_proxy(self):
        native.local.start_local_redirector.side_effect=PermissionError('denied')
        runtime=self.runtime({'mode':'local'})
        with self.assertRaises(PermissionError):await runtime.start()
        await runtime.close()
        self.policy.start.assert_not_awaited()
        native.local.start_local_redirector.side_effect=None


if __name__=='__main__':unittest.main()
