"""验证 DMG 中实际分发的应用签名，而非只检查编译出来的可执行文件。"""
import argparse
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile


def verify(image):
    config = json.loads((Path(__file__).parent / "src-tauri/tauri.conf.json").read_text())
    subprocess.run(["hdiutil", "verify", str(image)], check=True)
    with tempfile.TemporaryDirectory(prefix="apirequest-macos-installer-") as directory:
        subprocess.run([
            "hdiutil", "attach", "-readonly", "-nobrowse", "-noautoopen",
            "-mountpoint", directory, str(image),
        ], check=True)
        try:
            app = Path(directory) / f"{config['productName']}.app"
            with (app / "Contents/Info.plist").open("rb") as source:
                info = plistlib.load(source)
            if info.get("CFBundleIdentifier") != config["identifier"]:
                raise ValueError("The installer contains an unexpected application")
            subprocess.run([
                "codesign", "--verify", "--deep", "--strict", "--verbose=4", str(app),
            ], check=True)
            executable = info["CFBundleExecutable"]
            if Path(executable).name != executable:
                raise ValueError("Invalid application executable path")
            subprocess.run([
                "lipo", str(app / "Contents/MacOS" / executable), "-verify_arch", "arm64",
            ], check=True)
            print(f"Verified signed Mac ARM64 installer: {image.name}", flush=True)
        finally:
            subprocess.run(["hdiutil", "detach", directory], check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=lambda value: Path(value).resolve(strict=True))
    verify(parser.parse_args().image)
