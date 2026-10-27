import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fpmigrate import remote_access as r

class RemoteAccessTests(unittest.TestCase):
    def setUp(self):
        self.jf=SimpleNamespace(base_url='http://127.0.0.1:8096',public_info=lambda:{'Id':'server'})

    def test_other_computer_never_configures_this_computer(self):
        self.jf.base_url='http://192.0.2.10:8096'
        with patch.object(r,'Jellyfin') as client, patch.object(r,'command') as run, self.assertRaises(ValueError):
            client.return_value.public_info.return_value={'Id':'different'}
            r.enable(self.jf,lambda _:None)
        run.assert_not_called()

    def test_lan_address_of_same_local_server_is_automatic(self):
        self.jf.base_url='http://192.0.2.10:8096'
        with patch.object(r,'Jellyfin') as client:
            client.return_value.public_info.return_value={'Id':'server'}
            self.assertEqual(r.local_target(self.jf),'http://127.0.0.1:8096')

    def test_qr_generated_locally(self):
        self.assertTrue(r.qr('https://media.example.com').startswith('data:image/svg+xml'))

    def test_connected_workflow_skips_install_and_login(self):
        with patch.object(r,'executable',return_value='tailscale'),patch.object(r,'command',return_value='{"BackendState":"Running"}'),patch.object(r,'install') as install,patch.object(r.subprocess,'run') as login,patch.object(r,'enable',return_value={'url':'https://media.example.com'}) as enable:
            self.assertEqual(r.advance(self.jf,lambda _:None)['phase'],'phone')
            install.assert_not_called();login.assert_not_called();enable.assert_called_once()

    def test_account_permission_has_direct_action(self):
        with patch.object(r,'executable',return_value='tailscale'),patch.object(r,'command',return_value='{"BackendState":"Running"}'),patch.object(r,'enable',side_effect=r.ApprovalRequired('Enable the named switches, then Continue.')):
            result=r.advance(self.jf,lambda _:None)
        self.assertEqual(result['phase'],'approval')
        self.assertEqual(result['approval_url'],'https://login.tailscale.com/admin/dns')

    def test_provider_approval_link_survives_wait_timeout(self):
        url='https://login.tailscale.com/f/serve?node=example'
        error=r.subprocess.TimeoutExpired(['tailscale','serve'],30,output=('Approve: '+url).encode())
        with patch.object(r.subprocess,'run',side_effect=error):
            with self.assertRaises(r.ApprovalRequired) as caught:
                r.command(['tailscale','serve','--bg','--https=443','http://127.0.0.1:8096'])
        self.assertEqual(caught.exception.url,url)

    def test_untrusted_provider_link_is_not_offered(self):
        with patch.object(r.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='https://other.example.com/approve',stderr='')):
            with self.assertRaises(RuntimeError):r.command(['tailscale','serve','--bg'])

    def test_connection_failure_is_not_misreported_as_account_permission(self):
        with patch.object(r,'executable',return_value='tailscale'),patch.object(r,'command',return_value='{"BackendState":"Running"}'),patch.object(r,'enable',side_effect=RuntimeError('Connection interrupted')):
            with self.assertRaisesRegex(RuntimeError,'Connection interrupted'):
                r.advance(self.jf,lambda _:None)

    def test_missing_dns_requests_approval_without_creating_route(self):
        with patch.object(r,'status',return_value={'connected':True}),patch.object(r,'executable',return_value='tailscale'),patch.object(r,'command',return_value='{"Self":{}}') as run:
            with self.assertRaises(r.ApprovalRequired):r.enable(self.jf,lambda _:None)
        self.assertEqual(run.call_count,1)

    def test_public_forwarding_is_not_accepted_as_private(self):
        config={'Web':{'server.example.ts.net:443':{'Handlers':{'/':{'Proxy':self.jf.base_url}}}},'AllowFunnel':{'server.example.ts.net:443':True}}
        with patch.object(r,'status',return_value={'connected':True}),patch.object(r,'executable',return_value='tailscale'),patch.object(r,'command',side_effect=[json.dumps({'Self':{'DNSName':'server.example.ts.net'}}),json.dumps(config)]) as run:
            with self.assertRaisesRegex(ValueError,'public forwarding'):r.enable(self.jf,lambda _:None)
        self.assertEqual(run.call_count,2)

    def test_existing_proxy_is_not_replaced(self):
        with patch.object(r,'status',return_value={'connected':True}),patch.object(r,'executable',return_value='tailscale'),patch.object(r,'command',side_effect=[json.dumps({'Self':{'DNSName':'server.example.ts.net.'}}),json.dumps({'Web':{'another':{}}})]) as run:
            with self.assertRaisesRegex(ValueError,'already serves'):r.enable(self.jf,lambda _:None)
            self.assertEqual(run.call_count,2)

    def test_new_private_route_and_exact_server_check(self):
        calls=[]
        def run(args):
            calls.append(args)
            if args[1:]==['status','--json']:return json.dumps({'Self':{'DNSName':'server.example.ts.net.'}})
            return '{}'
        with patch.object(r,'status',return_value={'connected':True}),patch.object(r,'executable',return_value='tailscale'),patch.object(r,'command',side_effect=run),patch.object(r,'verify',return_value={'url':'https://server.example.ts.net','verified_away':False}) as verify:
            result=r.enable(self.jf,lambda _:None)
        self.assertIn(['tailscale','serve','--bg','--https=443','http://127.0.0.1:8096'],calls)
        self.assertFalse(result['verified_away']);verify.assert_called_once_with(self.jf,'https://server.example.ts.net')

    def test_https_address_must_match_server(self):
        with patch.object(r,'Jellyfin') as cls:
            cls.return_value.public_info.return_value={'Id':'other'}
            with self.assertRaisesRegex(ValueError,'does not identify'):r.verify(self.jf,'https://media.example.com')
            cls.return_value.public_info.return_value={'Id':'server'}
            self.assertFalse(r.verify(self.jf,'https://media.example.com')['verified_away'])

    def test_credentials_and_plaintext_rejected_before_network(self):
        with patch.object(r,'Jellyfin') as cls:
            for url in ['http://media.example.com','https://person:secret@'+'media.example.com','https://media.example.com?token=x']:
                with self.assertRaises(ValueError):r.verify(self.jf,url)
            cls.assert_not_called()

    def test_signed_out_never_enables_route(self):
        with patch.object(r,'status',return_value={'connected':False}),patch.object(r,'command') as run:
            with self.assertRaisesRegex(ValueError,'Sign in'):r.enable(self.jf,lambda _:None)
            run.assert_not_called()
