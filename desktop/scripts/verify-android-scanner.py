#!/usr/bin/env python3
"""Reject APKs missing scanner classes or the bundled offline model."""
import struct
import sys
import zipfile
from pathlib import Path

REQUIRED_CLASSES = {
    "Lapp/tauri/barcodescanner/BarcodeScannerPlugin;",
    "Lcom/google/mlkit/vision/barcode/BarcodeScannerOptions;",
    "Lcom/google/mlkit/vision/barcode/BarcodeScannerOptions$Builder;",
    "Lcom/google/mlkit/vision/barcode/BarcodeScanning;",
}


def defined_classes(dex: bytes) -> set[str]:
    if not dex.startswith(b"dex\n") or len(dex) < 112:
        raise ValueError("invalid DEX header")

    def u32(offset: int) -> int:
        return struct.unpack_from("<I", dex, offset)[0]

    string_count, strings = u32(56), u32(60)
    type_count, types = u32(64), u32(68)
    class_count, classes = u32(96), u32(100)

    def descriptor(class_type: int) -> str:
        if class_type >= type_count:
            raise ValueError("invalid type index")
        string_idx = u32(types + 4 * class_type)
        if string_idx >= string_count:
            raise ValueError("invalid string index")
        offset = u32(strings + 4 * string_idx)
        while dex[offset] & 0x80:
            offset += 1
        offset += 1  # Skip the last byte of the ULEB128 string length.
        end = dex.index(b"\x00", offset)
        return dex[offset:end].decode("utf-8", errors="replace")

    return {descriptor(u32(classes + 32 * i)) for i in range(class_count)}


def verify(apk: Path) -> None:
    with zipfile.ZipFile(apk) as package:
        names = package.namelist()
        classes = set()
        for name in names:
            if name.startswith("classes") and name.endswith(".dex") and "/" not in name:
                classes.update(defined_classes(package.read(name)))
        missing = REQUIRED_CLASSES - classes
        if missing:
            raise ValueError("missing class definitions: " + ", ".join(sorted(missing)))
        if not any(name.startswith("assets/mlkit_barcode_models/") and name.endswith(".tflite") for name in names):
            raise ValueError("bundled barcode model is missing")
        if not any(name.startswith("lib/arm64-v8a/") and name.endswith("/libbarhopper_v3.so") for name in names):
            raise ValueError("arm64 bundled barcode library is missing")
    print(f"Scanner classes and offline model verified: {apk}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit("usage: verify-android-scanner.py APK [APK ...]")
    for argument in sys.argv[1:]:
        try:
            verify(Path(argument))
        except (OSError, ValueError, IndexError, struct.error, zipfile.BadZipFile) as exc:
            raise SystemExit(f"{argument}: {exc}") from exc
