"""校验官方发行包并准备桌面抓包资源。"""
import hashlib
import io
from pathlib import Path
import platform
import shutil
import sys
import urllib.request
import zipfile

VERSION = '12.3.0'
ARCHIVES = {
    ('Darwin', 'arm64'): ('macos-arm64.tar.gz', 'ce2bccfb20bd75e38647dae35445b0c6d4f8fd7232bed250e9a939de8a6312c2'),
    ('Darwin', 'x86_64'): ('macos-x86_64.tar.gz', '58fa1a3fe720cb52b203a8f0b0d2ae963edd6ba545113363cfc0338322526d5c'),
    ('Windows', 'amd64'): ('windows-x86_64.zip', '5427f3520e6280a7390cfe7e6fade25c7768bbfea04d33678223c55817713050'),
}
desktop = Path(__file__).resolve().parent
source = desktop.parent / 'packages' / 'apirequest-selfhost-web' / 'capture'
stage = desktop / '.capture-runtime'
system = platform.system()
artifact, digest = ARCHIVES[(system, platform.machine().lower())]
filename = f'mitmproxy-{VERSION}-{artifact}'
if len(sys.argv) == 2:
    data = Path(sys.argv[1]).read_bytes()
else:
    url = f'https://downloads.mitmproxy.org/{VERSION}/{filename}'
    with urllib.request.urlopen(url, timeout=90) as response:
        data = response.read(100 * 1024 * 1024)
if hashlib.sha256(data).hexdigest() != digest:
    raise RuntimeError(f'SHA-256 mismatch for {filename}')
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir()
for filename in ('recorder.py', 'session.py', 'system_proxy.py', 'memory.py', 'archive.py', 'proxy_listener.py', 'capture_modes.py', 'capture_context.py', 'controller.py', 'archive_api.py', 'portable.py', 'replay.py'):
    shutil.copyfile(source / filename, stage / filename)
if system == 'Darwin':
    # 保留官方应用的 framework 链接和签名，首次启用时解包到应用数据目录。
    (stage / 'mitmproxy-12.3.0.tar.gz').write_bytes(data)
else:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        (stage / 'mitmdump.exe').write_bytes(archive.read('mitmdump.exe'))
