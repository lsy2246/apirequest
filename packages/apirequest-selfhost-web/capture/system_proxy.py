"""显式启用的系统 PAC。接收代理流量并绕过工作台，并可恢复启用前的设置。"""
import hashlib
import http.server
import json
import os
from pathlib import Path
import platform
import re
import ssl
import subprocess
import threading


class SystemProxy:
    def __init__(self, confdir, port, internal_hosts=(), internal_ports=()):
        self.root = Path(confdir)
        self.snapshot = self.root / 'apirequest-system-proxy.json'
        self.certificate = self.root / 'mitmproxy-ca-cert.pem'
        self.port = port
        self.internal_hosts, self.internal_ports = sorted(internal_hosts), sorted(internal_ports)
        self.server = None
        self.os = platform.system()

    def run(self, *args, input=None):
        env = dict(os.environ, LC_ALL='C', LANG='C')
        return subprocess.run(args, env=env, capture_output=True, text=True, input=input, check=True, timeout=12).stdout

    def services(self):
        if self.os != 'Darwin':
            return []
        return [name.strip() for name in self.run('/usr/sbin/networksetup', '-listallnetworkservices').splitlines()[1:]
                if name.strip() and not name.strip().startswith('*')]

    def default_service(self):
        # 读取当前默认路由所属服务，VPN/多网卡下不按列表顺序猜测，也不覆盖其他接口。
        for family in ('IPv4', 'IPv6'):
            state = self.run('/usr/sbin/scutil', input=f'show State:/Network/Global/{family}\n')
            match = re.search(r'PrimaryService\s*:\s*([A-Fa-f0-9-]+)', state)
            if match:
                setup = self.run('/usr/sbin/scutil', input=f'show Setup:/Network/Service/{match[1]}\n')
                name = re.search(r'UserDefinedName\s*:\s*(.+)', setup)
                if name and name[1].strip() in self.services():
                    return name[1].strip()
        raise ValueError('network_service_required')

    def status(self, can_enable=False):
        supported = self.os in ('Darwin', 'Windows')
        available = self.certificate.exists()
        return dict(supported=supported, canEnable=can_enable,
                    active=self.server is not None,
                    recoveryPending=self.snapshot.exists() and self.server is None,
                    services=self.services() if supported else [],
                    certificateAvailable=available,
                    certificateTrusted=self.trust('status') if supported and available else False)

    def mac_current(self, service):
        output = self.run('/usr/sbin/networksetup', '-getautoproxyurl', service)
        settings = dict(line.split(': ', 1) for line in output.splitlines() if ': ' in line)
        return {'url': settings.get('URL', ''), 'enabled': settings.get('Enabled') == 'Yes'}

    def mac_apply(self, service, settings):
        tool = '/usr/sbin/networksetup'
        if settings['url'] and settings['url'] not in ('(null)', 'null'):
            self.run(tool, '-setautoproxyurl', service, settings['url'])
        self.run(tool, '-setautoproxystate', service, 'on' if settings['enabled'] else 'off')

    def win_current(self):
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Internet Settings') as key:
            try:
                value, _ = winreg.QueryValueEx(key, 'AutoConfigURL')
            except FileNotFoundError:
                value = None
        return {'url': value, 'enabled': bool(value)}

    def win_apply(self, settings):
        import ctypes
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Internet Settings', 0, winreg.KEY_SET_VALUE) as key:
            if settings['url'] is not None:
                winreg.SetValueEx(key, 'AutoConfigURL', 0, winreg.REG_SZ, settings['url'])
            else:
                try:
                    winreg.DeleteValue(key, 'AutoConfigURL')
                except FileNotFoundError:
                    pass
        ctypes.windll.Wininet.InternetSetOptionW(None, 39, None, 0)
        ctypes.windll.Wininet.InternetSetOptionW(None, 37, None, 0)

    def current(self, service):
        return self.mac_current(service) if self.os == 'Darwin' else self.win_current()

    def apply(self, service, settings):
        if self.os == 'Darwin':
            self.mac_apply(service, settings)
        else:
            self.win_apply(settings)

    def restore(self):
        if self.snapshot.exists():
            saved = json.loads(self.snapshot.read_text())
            current = self.current(saved['service'])
            # 用户在其他程序里修改代理后，以用户的新配置为准。
            if current == saved['active']:
                self.apply(saved['service'], saved['previous'])
            self.snapshot.unlink()
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None

    def has_other_proxy(self, service):
        # 已有手动代理时不覆盖原有路由；关闭时只恢复本功能持有的快照。
        if self.os == 'Darwin':
            return any('Enabled: Yes' in self.run('/usr/sbin/networksetup', flag, service)
                       for flag in ('-getwebproxy', '-getsecurewebproxy', '-getsocksfirewallproxy')
                       )
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Software\Microsoft\Windows\CurrentVersion\Internet Settings') as key:
            for name in ('ProxyEnable', 'AutoDetect'):
                try:
                    if winreg.QueryValueEx(key, name)[0]:
                        return True
                except FileNotFoundError:
                    pass
        return False

    def enable(self, service=None):
        if self.os not in ('Darwin', 'Windows'):
            raise ValueError('system_unavailable')
        if self.os == 'Darwin' and not service:
            service = self.default_service()
        if self.os == 'Darwin' and service not in self.services():
            raise ValueError('system_unavailable')
        if self.snapshot.exists():
            self.restore()
        old = self.current(service)
        if old['enabled'] or self.has_other_proxy(service):
            raise ValueError('existing_pac')
        pac = ("function FindProxyForURL(url, host) {\n"
               f"  var hosts = {json.dumps(self.internal_hosts)};\n"
               f"  var ports = {json.dumps(self.internal_ports)};\n"
               "  var normalized = host.toLowerCase().replace(/\\.$/, '').replace(/^\\[|\\]$/g, '');\n"
               "  var match = /^[a-z]+:\\/\\/[^/]+?:(\\d+)(?:[/?#]|$)/i.exec(url);\n"
               "  var port = match ? Number(match[1]) : (/^https:/i.test(url) ? 443 : 80);\n"
               f"  if (port === {self.port}) return 'DIRECT';\n"
               "  if (ports.indexOf(port) >= 0 && (hosts.indexOf(normalized) >= 0 || /^127\\./.test(normalized) || /\\.localhost$/.test(normalized))) return 'DIRECT';\n"
               f"  return 'PROXY 127.0.0.1:{self.port}';\n}}\n").encode()

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path != '/apirequest.pac' or self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}':
                    self.send_error(404)
                    return
                self.send_response(200)
                self.send_header('Content-Type', 'application/x-ns-proxy-autoconfig')
                self.send_header('Cache-Control', 'no-store')
                self.send_header('Content-Length', str(len(pac)))
                self.end_headers()
                self.wfile.write(pac)

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        active = {'url': f'http://127.0.0.1:{self.server.server_port}/apirequest.pac', 'enabled': True}
        temp = self.snapshot.with_suffix('.tmp')
        temp.write_text(json.dumps({'service': service, 'previous': old, 'active': active}))
        temp.replace(self.snapshot)
        try:
            self.apply(service, active)
        except Exception:
            self.restore()
            raise

    def trust(self, action):
        pem = self.certificate.read_text()
        digest = hashlib.sha1(ssl.PEM_cert_to_DER_cert(pem)).hexdigest().upper()
        if self.os == 'Darwin':
            security = '/usr/bin/security'
            keychain = self.run(security, 'default-keychain', '-d', 'user').strip().strip('"')
            if action == 'install':
                self.run(security, 'add-trusted-cert', '-r', 'trustRoot', '-k', keychain, str(self.certificate))
            elif action == 'remove':
                self.run(security, 'remove-trusted-cert', str(self.certificate))
                self.run(security, 'delete-certificate', '-Z', digest, keychain)
            try:
                self.run(security, 'verify-cert', '-c', str(self.certificate), '-p', 'ssl')
                return True
            except subprocess.CalledProcessError:
                return False
        if self.os == 'Windows':
            exe = str(Path(os.environ['SystemRoot']) / 'System32' / 'certutil.exe')
            if action == 'install':
                self.run(exe, '-user', '-addstore', 'Root', str(self.certificate))
            elif action == 'remove':
                self.run(exe, '-user', '-delstore', 'Root', digest)
            try:
                return digest in re.sub(r'\s+', '', self.run(exe, '-user', '-store', 'Root', digest)).upper()
            except subprocess.CalledProcessError:
                return False
        raise ValueError('system_unavailable')
