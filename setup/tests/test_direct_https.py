import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
from fpmigrate import direct_https as d
from fpmigrate.netio import redact

class DirectHttpsTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.folder=Path(self.tmp.name)
        self.config={'KnownProxies':['192.0.2.2'],'EnableRemoteAccess':False,'OtherSetting':'keep'}
        self.jf=SimpleNamespace(base_url='http://127.0.0.1:8096',public_info=lambda:{'Id':'server'},call=Mock(side_effect=self.call))
        self.progress=Mock()
    def call(self,method,path,**kwargs):
        if method=='GET':return dict(self.config)
        self.config=dict(kwargs['body']);return None
    def state(self,**extra):
        s={'server_id':'server','host':'library.duckdns.org','upstream':'http://127.0.0.1:8096','dns_mode':'duckdns','network_before':{'KnownProxies':[],'EnableRemoteAccess':False},'network_applied':{'KnownProxies':['127.0.0.1','::1'],'EnableRemoteAccess':True},'network_changed':True}
        s.update(extra);d.paths(self.folder)[1].write_text(json.dumps(s));return s
    def test_hostname_cannot_inject_caddy_or_command(self):
        for host in ['abc.org\nadmin off','abc.org:443','https://user@example.org','https://abc.org/a','https://abc.org/?x=y','127.0.0.1','abc.internal','*.abc.org','-a.example.org']:
            with self.subTest(host=host),self.assertRaises(ValueError):d.hostname(host)
        self.assertEqual(d.hostname('https://My-Library.duckdns.org/'),'my-library.duckdns.org')
    def test_other_server_is_not_forwarded(self):
        self.jf.base_url='http://192.0.2.5:8096'
        with patch.object(d.remote_access,'Jellyfin') as other,self.assertRaises(ValueError):
            other.return_value.public_info.return_value={'Id':'other'};d.target(self.jf)
    def test_cgnat_and_mismatch_offer_fallback_without_writes(self):
        for wan in ['100.64.1.2','192.0.2.1','8.8.4.4']:
            with patch.object(d,'network',return_value={'public_ip':'8.8.8.8','lan_ip':'192.0.2.9'}):
                result=d.assess(self.jf,{'router_wan':wan},self.progress)
            self.assertIs(result['direct_possible'],False)
        self.jf.call.assert_not_called()
    def test_missing_wan_never_claims_incoming_reachability(self):
        with patch.object(d,'network',return_value={'public_ip':'8.8.8.8'}):
            self.assertIsNone(d.assess(self.jf,{},self.progress)['direct_possible'])
    def test_no_confirmation_no_install(self):
        with patch.object(d.sys,'platform','win32'),patch.object(d,'executable') as install,self.assertRaises(ValueError):
            d.configure(self.jf,self.folder,{'hostname':'library.duckdns.org'},self.progress)
        install.assert_not_called();self.jf.call.assert_not_called()
    def test_failed_elevation_preserves_retry_record_without_network_mutation(self):
        cli=self.folder/'caddy.exe';cli.write_bytes(b'test')
        with patch.object(d.sys,'platform','win32'),patch.object(d,'executable',return_value=str(cli)),patch('fpmigrate.elevate.run_direct_action',side_effect=PermissionError('declined')):
            with self.assertRaises(PermissionError):d.configure(self.jf,self.folder,{'hostname':'library.duckdns.org','dns_mode':'duckdns','dns_token':'a'*32,'expose':True},self.progress)
        state=d.read_state(self.folder,self.jf)
        self.assertNotIn('dns_token',state);self.assertEqual(state['phase'],'installing')
        self.assertFalse(self.config['EnableRemoteAccess'])
    def test_configure_merges_network_and_does_not_claim_remote_success(self):
        cli=self.folder/'caddy.exe';cli.write_bytes(b'test')
        def elevated(payload):
            self.assertNotIn('token',payload);self.config['OtherSetting']='changed during UAC'
            return {'installed':True,'dns_updated':True}
        with patch.object(d.sys,'platform','win32'),patch.object(d,'executable',return_value=str(cli)),patch('fpmigrate.elevate.run_direct_action',side_effect=elevated),patch.object(d,'network',return_value={}):
            result=d.configure(self.jf,self.folder,{'hostname':'library.duckdns.org','dns_mode':'duckdns','dns_token':'a'*32,'expose':True},self.progress)
        self.assertEqual(result['phase'],'router');self.assertNotIn('verified_away',result)
        self.assertEqual(self.config['OtherSetting'],'changed during UAC')
        self.assertEqual(self.config['KnownProxies'],['192.0.2.2','127.0.0.1','::1'])
    def test_existing_owned_address_cannot_be_silently_replaced(self):
        self.state()
        with patch.object(d.sys,'platform','win32'),patch.object(d,'executable') as install,self.assertRaises(ValueError):
            d.configure(self.jf,self.folder,{'hostname':'different.duckdns.org','dns_mode':'duckdns','expose':True},self.progress)
        install.assert_not_called()
    def test_local_verification_never_sets_away_success(self):
        self.state()
        with patch.object(d.remote_access,'verify',return_value={'url':'https://library.duckdns.org','verified_here':True,'verified_away':False}):
            result=d.check(self.jf,self.folder,{},self.progress)
        self.assertFalse(result['verified_away']);self.assertEqual(result['phase'],'phone')
    def test_failed_loopback_still_allows_explicit_mobile_test(self):
        self.state()
        with patch.object(d.remote_access,'verify',side_effect=RuntimeError('unreachable')):
            result=d.check(self.jf,self.folder,{},self.progress)
        self.assertTrue(result['show_phone']);self.assertFalse(result['verified_here']);self.assertFalse(result['verified_away'])
    def test_owner_confirmation_bound_to_exact_url(self):
        self.state()
        with self.assertRaises(ValueError):d.confirm(self.jf,self.folder,{'away_played':True,'url':'https://other.org'},self.progress)
        result=d.confirm(self.jf,self.folder,{'away_played':True,'url':'https://library.duckdns.org'},self.progress)
        self.assertEqual(result['verification_source'],'owner_reported')
    def test_remove_preserves_later_admin_network_changes(self):
        self.state();self.config={'KnownProxies':['192.0.2.99'],'EnableRemoteAccess':True,'OtherSetting':'keep'}
        with patch('fpmigrate.elevate.run_direct_action') as helper:d.remove(self.jf,self.folder,{},self.progress)
        helper.assert_called_once();self.assertEqual(self.config['KnownProxies'],['192.0.2.99']);self.assertFalse(self.config['EnableRemoteAccess'])
    def test_server_rebinding_rejected(self):
        self.state(server_id='other')
        with self.assertRaises(ValueError):d.resume(self.jf,self.folder,{},self.progress)
    def test_secret_redaction(self):
        self.assertNotIn('secret',redact('https://www.duckdns.org/update?token=secret&ip=1'))
        self.assertNotIn('secret',redact('{"dns_token":"secret"}'))
