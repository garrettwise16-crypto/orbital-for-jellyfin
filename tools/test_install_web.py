import subprocess, sys, tempfile, unittest
from pathlib import Path

TOOL = Path(__file__).with_name('install_web.py')
# Shaped like jellyfin-web's index.html: Jellyfin's scripts load from <head>.
# Multi-line with LF endings, written as bytes, so a changed line ending fails the test on any OS.
STOCK = ('<!doctype html>\n<html class="preload"><head><meta charset="utf-8"><title>Jellyfin</title>\n'
         '<script defer="defer" src="runtime.bundle.js?abc"></script><link href="main.jellyfin.css" rel="stylesheet">\n'
         '</head><body><div class="mainAnimatedPages"></div></body></html>\n').encode('utf-8')


def run(*args):
    return subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True)


class InstallWeb(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.web = Path(self.tmp.name)
        (self.web / 'index.html').write_bytes(STOCK)
        (self.web / 'other.txt').write_text('keep', encoding='utf-8')

    def tearDown(self):
        self.tmp.cleanup()

    def test_install_twice_then_uninstall_restores_exact_index(self):
        art = self.web.parent / (self.web.name + '-art.js')
        art.write_text('window.OrbitalTeamArt={};', encoding='utf-8')
        self.addCleanup(art.unlink)
        self.assertEqual(run('--web-dir', str(self.web), '--team-art', str(art)).returncode, 0)
        self.assertEqual(run('--web-dir', str(self.web)).returncode, 0)
        index = (self.web / 'index.html').read_text(encoding='utf-8')
        self.assertEqual(index.count('<!-- orbital:begin -->'), 1)
        self.assertLess(index.index('orbital/orbital-customer.js'), index.index('runtime.bundle.js'))
        self.assertIn('orbital/team-art.js', index)  # kept on the second run

        self.assertEqual(run('--web-dir', str(self.web), '--no-team-art').returncode, 0)
        self.assertNotIn('team-art.js', (self.web / 'index.html').read_text(encoding='utf-8'))
        self.assertFalse((self.web / 'orbital' / 'team-art.js').exists())

        self.assertEqual(run('--web-dir', str(self.web), '--uninstall').returncode, 0)
        self.assertEqual((self.web / 'index.html').read_bytes(), STOCK)
        self.assertEqual(sorted(p.name for p in self.web.iterdir()), ['index.html', 'other.txt'])

    def test_refuses_a_folder_it_did_not_create(self):
        (self.web / 'orbital').mkdir()
        result = run('--web-dir', str(self.web))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.web / 'index.html').read_bytes(), STOCK)

    def test_refuses_a_page_that_is_not_jellyfin(self):
        (self.web / 'index.html').write_text('<html><head><script src="a.js"></script></head></html>', encoding='utf-8')
        self.assertNotEqual(run('--web-dir', str(self.web)).returncode, 0)
        self.assertFalse((self.web / 'orbital').exists())


if __name__ == '__main__':
    unittest.main()
