import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "tools" / "get_openid.py"
ASSET = SCRIPT.parents[1] / "app" / "src" / "main" / "assets" / "get_openid.py"


class OpenidExtractorTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.env = dict(os.environ, HOME=str(self.home))

    def cache(self, root, openid="test_openid_123"):
        directory = root / "radium/web/profiles/webview_test/Cache/Cache_Data"
        directory.mkdir(parents=True)
        (directory / "entry").write_bytes(
            ('cqupt {"openid":"%s"}' % openid).encode()
        )

    def run_script(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)],
                              env=self.env, text=True, capture_output=True)

    def test_macos_container_layouts(self):
        for container in ("com.tencent.xinWeChat2", "com.tencent.xinWeChat"):
            with self.subTest(container=container):
                root = self.home / "Library/Containers" / container / "Data/Documents/app_data"
                self.cache(root)
                result = self.run_script()
                self.assertEqual(result.returncode, 0, result.stdout)
                self.assertIn("test_openid_123", result.stdout)
                shutil.rmtree(root)

    def test_explicit_directory_only_searches_that_tree(self):
        self.cache(self.home / "elsewhere", "unrelated_openid")
        target = self.home / "selected"
        self.cache(target / "nested", "selected_openid")
        result = self.run_script(target)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertIn("selected_openid", result.stdout)
        self.assertNotIn("unrelated_openid", result.stdout)

    def test_invalid_explicit_directory_fails(self):
        result = self.run_script(self.home / "missing")
        self.assertEqual(result.returncode, 2)
        self.assertIn("指定的目录不存在", result.stdout)

    def test_shared_app_script_matches(self):
        self.assertEqual(SCRIPT.read_bytes(), ASSET.read_bytes())


if __name__ == "__main__":
    unittest.main()
