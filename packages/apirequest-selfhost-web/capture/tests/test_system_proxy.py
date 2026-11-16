"""通过系统设置替身验证 PAC 生命周期，测试不会修改本机代理或信任库。"""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location("system_proxy", Path(__file__).resolve().parents[1] / "system_proxy.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProxyLifecycle(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.proxy = module.SystemProxy(self.directory.name, 18888, ['localhost', '127.0.0.1'], [3001, 3171])
        self.proxy.os = 'Darwin'
        self.previous = {'url': 'https://old.invalid/dormant.pac', 'enabled': False}
        self.settings = dict(self.previous)
        self.proxy.services = lambda: ['Test Service']
        self.proxy.current = lambda service: dict(self.settings)
        self.proxy.has_other_proxy = lambda service: False
        self.proxy.apply = lambda service, settings: self.settings.update(settings)

    def tearDown(self):
        self.proxy.restore()
        self.directory.cleanup()

    def test_general_pac_and_normal_restore(self):
        self.proxy.enable('Test Service')
        active = dict(self.settings)
        with urllib.request.urlopen(active['url'], timeout=2) as response:
            pac = response.read().decode()
        self.assertIn("return 'PROXY 127.0.0.1:18888'", pac)
        self.assertIn('3001', pac)
        self.assertNotIn('targets', pac)
        self.assertIn('return \'DIRECT\'', pac)
        with self.assertRaises(urllib.error.HTTPError) as denied:
            urllib.request.urlopen(urllib.request.Request(active['url'], headers={'Host': 'foreign.invalid'}), timeout=2)
        self.assertEqual(denied.exception.code, 404)
        self.proxy.restore()
        self.assertEqual(self.settings, self.previous)
        self.assertFalse(self.proxy.snapshot.exists())
        self.assertIsNone(self.proxy.server)

    def test_recovery_uses_persisted_snapshot(self):
        self.proxy.enable('Test Service')
        self.proxy.server.shutdown()
        self.proxy.server.server_close()
        self.proxy.server = None
        self.proxy.restore()
        self.assertEqual(self.settings, self.previous)

    def test_preserves_user_change(self):
        self.proxy.enable('Test Service')
        changed = {'url': 'https://new.invalid/user.pac', 'enabled': True}
        self.settings.update(changed)
        self.proxy.restore()
        self.assertEqual(self.settings, changed)

    def test_restore_failure_keeps_recovery_snapshot(self):
        self.proxy.enable('Test Service')
        original = self.proxy.apply
        def denied(*_):
            raise PermissionError()
        self.proxy.apply = denied
        with self.assertRaises(PermissionError):
            self.proxy.restore()
        self.assertTrue(self.proxy.snapshot.exists())
        self.proxy.apply = original
        self.proxy.restore()
        self.assertEqual(self.settings, self.previous)

    def test_default_service_uses_primary_network_instead_of_first_entry(self):
        self.proxy.services = lambda: ['Unused Ethernet', 'Active Wi-Fi']
        def run(*args, input=None):
            if input == 'show State:/Network/Global/IPv4\n':
                return 'PrimaryService : A123-B456\n'
            if input == 'show Setup:/Network/Service/A123-B456\n':
                return 'UserDefinedName : Active Wi-Fi\n'
            raise AssertionError(input)
        self.proxy.run = run
        self.assertEqual(self.proxy.default_service(), 'Active Wi-Fi')
        self.proxy.enable()
        saved = __import__('json').loads(self.proxy.snapshot.read_text())
        self.assertEqual(saved['service'], 'Active Wi-Fi')

    def test_unknown_default_network_requires_selection_without_writes(self):
        self.proxy.run = lambda *args, **kwargs: ''
        with self.assertRaisesRegex(ValueError, 'network_service_required'):
            self.proxy.enable()
        self.assertEqual(self.settings, self.previous)
        self.assertFalse(self.proxy.snapshot.exists())
        self.assertIsNone(self.proxy.server)

    def test_existing_route_is_preserved(self):
        self.proxy.has_other_proxy = lambda service: True
        with self.assertRaisesRegex(ValueError, 'existing_pac'):
            self.proxy.enable('Test Service')
        self.assertEqual(self.settings, self.previous)
        self.assertIsNone(self.proxy.server)


if __name__ == '__main__':
    unittest.main()
