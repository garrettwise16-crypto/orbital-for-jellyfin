import json
import sys
import tempfile
import unittest
from pathlib import Path
from urllib.parse import urlsplit
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'sports_service/app'))
import personal_library

class PersonalLibraryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.calls=[]
        def fetch(url, token):
            self.calls.append((url, token))
            path=urlsplit(url).path
            if path=='/Users/Me':
                return {'Id':('b' if token=='second' else 'a')*32,
                        'Policy':{'IsDisabled':token=='disabled'}}
            if path.endswith('/Items'):
                return {'Items':[{'Id':'c'*32,'Name':'Test movie','Type':'Movie','PlayAccess':'Full'}], 'TotalRecordCount':1}
            raise AssertionError(path)
        self.service=personal_library.create(self.temp.name,'http://127.0.0.1:8096',fetch)
    def request(self, method, endpoint, token='first', data=None):
        headers={'Authorization':'MediaBrowser Token="'+token+'"','Content-Type':'application/json'} if token else {}
        return self.service.request(method,'/sports/api/experience/v1/'+endpoint,headers,
                                    json.dumps(data).encode() if data is not None else b'')
    def test_fresh_user_has_free_capabilities_without_account_allowlist(self):
        code,data=self.request('GET','state')
        self.assertEqual(code,200)
        self.assertTrue(data['capabilities']['personal'])
        self.assertTrue(data['capabilities']['shelves'])
    def test_missing_token_and_disabled_account_rejected(self):
        self.assertEqual(self.request('GET','state',token='')[0],401)
        self.assertEqual(self.request('GET','state',token='disabled')[0],403)
    def test_watchlist_is_isolated_and_revisions_reject_stale_writes(self):
        code,state=self.request('GET','state')
        change={'revision':state['revision'],'operation':{'kind':'watchlist_add','id':'c'*32}}
        self.assertEqual(self.request('POST','state',data=change)[0],200)
        self.assertEqual(self.request('GET','state')[1]['watchlist'],['c'*32])
        self.assertEqual(self.request('GET','state',token='second')[1]['watchlist'],[])
        self.assertEqual(self.request('POST','state',data=change)[0],409)
    def test_private_context_route_absent(self):
        self.assertEqual(self.request('GET','owner-context')[0],404)
    def test_requests_require_configured_linked_service(self):
        self.assertEqual(self.request('POST','discover-submit',data={})[0],403)

if __name__=='__main__':unittest.main()
