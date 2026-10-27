import json, os, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'sports_service/app'))
import integrations

class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        env=patch.dict(os.environ,SPORTS_DATA_DIR=self.temp.name);env.start();self.addCleanup(env.stop)
    def test_fresh_defaults_need_no_key_and_mask_all_keys(self):
        self.assertTrue(integrations.masked()['personal_library'])
        self.assertFalse(integrations.masked()['requests']['enabled'])
        self.assertNotIn('key',integrations.masked({'requests':{'key':'sensitive'}})['requests'])
    def test_failed_connection_does_not_replace_saved_settings(self):
        integrations.save({'personal_library':False})
        before=integrations.path().read_bytes()
        with patch.object(integrations,'FixedJsonGet',side_effect=ValueError('unreachable')):
            with self.assertRaises(ValueError):integrations.save({'requests':{'enabled':True,'url':'http://example.com','key':'test'}})
        self.assertEqual(integrations.path().read_bytes(),before)
    def test_link_discovery_uses_ids_not_names_and_rejects_duplicates(self):
        def fetch(*args,**kwargs):
            return {'results':[{'id':1,'jellyfinUserId':'a'*32,'displayName':'Same'},
                               {'id':2,'jellyfinUserId':'b'*32,'displayName':'Same'},
                               {'id':3,'jellyfinUserId':'b'*32}]}
        linked=integrations.LinkedAccounts('http://example.com','test',fetch)
        self.assertEqual(linked['a'*32],1)
        self.assertNotIn('b'*32,linked)
        self.assertNotIn('Same',linked)
    def test_url_with_embedded_credentials_is_rejected(self):
        with self.assertRaises(ValueError):
            integrations.save({'requests':{'enabled':True,'url':'https://name:pass@example.com','key':'test'}})
    def test_setup_passes_configuration_as_body_not_query(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        from fpmigrate.webui import App
        jf=Mock();jf.call.return_value={'saved':True}
        app=SimpleNamespace(engine=SimpleNamespace(jf=jf))
        body={'personal_library':True,'requests':{'enabled':False}}
        self.assertEqual(App.integrations_set(app,{},body),{'saved':True})
        jf.call.assert_called_once_with('POST','/sports/api/integrations',body=body,timeout=15,retries=0)

if __name__=='__main__':unittest.main()
