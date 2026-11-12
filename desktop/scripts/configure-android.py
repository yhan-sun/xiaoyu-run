#!/usr/bin/env python3
"""Configure the generated Tauri Android project before building an APK."""
from pathlib import Path
import re
import sys

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "src-tauri/gen/android/app/build.gradle.kts"
text = path.read_text(encoding="utf-8")

# Tauri's current AGP 9 template enables the new optimization DSL for release.
# Fail closed if the generated template changes.
pattern = r'(getByName\("release"\)\s*\{\s*)(optimization\s*\{\s*enable\s*=\s*(?:true|false)\s*\})'
text, count = re.subn(pattern, r'\1optimization {\n                enable = false\n            }', text, count=1)
if count != 1:
    raise SystemExit("Unsupported Tauri Android release template; inspect optimization settings")

# The upstream scanner uses the Play Services downloaded model. Substitute the
# bundled equivalent so scanning works without Play Services or a model download.
marker = "// XiaoYuRun: use the bundled ML Kit barcode model"
if marker not in text:
    text += '''\n\n// XiaoYuRun: use the bundled ML Kit barcode model\nconfigurations.configureEach {\n    resolutionStrategy.dependencySubstitution {\n        substitute(module("com.google.android.gms:play-services-mlkit-barcode-scanning"))\n            .using(module("com.google.mlkit:barcode-scanning:17.3.0"))\n    }\n}\n'''
path.write_text(text, encoding="utf-8")
print(f"Configured release optimization and bundled barcode model: {path}")
