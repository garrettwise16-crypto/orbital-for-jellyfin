import unittest
from pathlib import Path
import scan_public as scanner

class ScopedExceptions(unittest.TestCase):
    def test_personal_connector_exception_is_narrow(self):
        term = 're' + 'bel'
        self.assertTrue(scanner.allowed('private media source', Path('setup/fpmigrate/' + term + '.py'), term))
        self.assertFalse(scanner.allowed('private media source', Path('web/dist/orbital.js'), term))
        self.assertFalse(scanner.allowed('private media source', Path('setup/fpmigrate/' + term + '.py'), 'tre' + 'x'))
    def test_browser_callback_only_in_named_distribution_files(self):
        rule = next(k for k in scanner.RULES if k.startswith('proprietary'))
        term = 'requestVideo' + 'FrameCallback'
        for name in ('web/dist/orbital.js', 'dist/live-tv.js', 'web/dist/phone.js'):
            self.assertTrue(scanner.allowed(rule, Path(name), term))
        for name in ('private/dist/orbital.js', 'web/dist/extra.js', 'other.js'):
            self.assertFalse(scanner.allowed(rule, Path(name), term))

    def test_no_blanket_source_exception(self):
        rule = 'private media source'
        self.assertTrue(scanner.allowed(rule, Path('web/dist/orbital.js'), 'm3' + 'u8'))
        self.assertFalse(scanner.allowed(rule, Path('web/dist/orbital.js'), 'not-allowed'))
