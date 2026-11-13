#!/usr/bin/env python3
"""Configure the generated Tauri Android project before building an APK."""
from pathlib import Path
import re
import shutil
import sys

path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "src-tauri/gen/android/app/build.gradle.kts"
text = path.read_text(encoding="utf-8")

# Tauri's current AGP 9 template enables the new optimization DSL for release.
# Fail closed if the generated template changes.
pattern = r'(getByName\("release"\)\s*\{\s*)(optimization\s*\{\s*enable\s*=\s*(?:true|false)\s*\})'
text, count = re.subn(pattern, r'\1optimization {\n                enable = false\n            }', text, count=1)
if count != 1:
    raise SystemExit("Unsupported Tauri Android release template; inspect optimization settings")

# The bundled model also depends on play-services-mlkit-barcode-scanning for its
# public API classes. Keep that dependency: the model itself is bundled.
marker = "// XiaoYuRun: use the bundled ML Kit barcode model"
old = '''// XiaoYuRun: use the bundled ML Kit barcode model
configurations.configureEach {
    exclude(group = "com.google.android.gms", module = "play-services-mlkit-barcode-scanning")
}
dependencies {
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
}'''
new = '''// XiaoYuRun: use the bundled ML Kit barcode model
dependencies {
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
}'''
if old in text:
    text = text.replace(old, new)
elif marker not in text:
    text += "\n\n" + new + "\n"
elif new not in text:
    raise SystemExit("Unsupported existing scanner configuration; inspect dependencies")
path.write_text(text, encoding="utf-8")
print(f"Configured release optimization and bundled barcode model: {path}")

# android init creates a fresh native project in CI. Copy the checked-in
# launcher resources after init so the APK uses the same approved artwork.
icons = Path(__file__).resolve().parents[1] / "src-tauri/icons/android"
if not (icons / "mipmap-anydpi-v26/ic_launcher.xml").is_file():
    raise SystemExit("Missing Android launcher resources")
resources = path.parent / "src/main/res"
shutil.copytree(icons, resources, dirs_exist_ok=True)
print(f"Installed Android launcher resources: {resources}")
