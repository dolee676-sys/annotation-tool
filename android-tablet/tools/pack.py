#!/usr/bin/env python3
"""Linux equivalent of android-tablet/tools/pack.ps1.

Adds classes.dex at the APK root and every file under the assets dir as
assets/<relative-path>, all DEFLATE-compressed (matches PowerShell
CompressionLevel.Optimal). Usage:
    python3 pack.py <apk> <classes.dex> <assets-dir>
"""
import os
import sys
import zipfile


def main() -> int:
    apk, dex, asset_root = sys.argv[1], sys.argv[2], sys.argv[3]
    asset_root = os.path.normpath(asset_root)
    with zipfile.ZipFile(apk, "a", zipfile.ZIP_DEFLATED) as z:
        z.write(dex, "classes.dex")
        for root, _dirs, files in os.walk(asset_root):
            for name in sorted(files):
                full = os.path.join(root, name)
                rel = os.path.relpath(full, asset_root).replace(os.sep, "/")
                z.write(full, "assets/" + rel)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
