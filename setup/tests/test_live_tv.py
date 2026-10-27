import json
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fpmigrate import live_tv
from fpmigrate.netio import HttpError, redact

BODY = {'kind': 'm3u', 'url': 'http://provider.example/list.m3u', 'guide': 'http://provider.example/guide.xml'}
PLAYLIST = b'#EXTM3U\n#EXTINF:-1 tvg-id="one",Example\nhttp://provider.example/never-open.ts\n'

class LiveTvTests(unittest.TestCase):
    def test_xtream_encodes_credentials_and_guide(self):
        c = live_tv.settings({'kind':'xtream','url':'https://provider.example:8080','username':'a&b','password':'p?/#+'})
        self.assertEqual(parse_qs(urlsplit(c['url']).query)['password'], ['p?/#+'])
        self.assertEqual(parse_qs(urlsplit(c['guide']).query)['username'], ['a&b'])
        self.assertNotIn('p?/#', redact(c['guide']))
        self.assertNotIn('a%26b', redact(c['url']))

    def test_only_channel_and_guide_metadata_are_requested(self):
        with patch.object(live_tv, 'metadata', side_effect=[(PLAYLIST,False),(b'<tv></tv>',False)]) as fetch:
            result = live_tv.check(BODY)
        self.assertEqual(result['channels'],1)
        self.assertTrue(result['guide_checked'])
        self.assertEqual([c.args[0] for c in fetch.call_args_list], [BODY['url'],BODY['guide']])

    def test_bad_guide_prevents_all_jellyfin_mutations(self):
        jf=Mock()
        with patch.object(live_tv,'metadata',side_effect=[(PLAYLIST,False),(b'<html>login</html>',False)]):
            with self.assertRaisesRegex(ValueError,'XMLTV'): live_tv.save(jf,BODY)
        jf.call.assert_not_called()

    def test_existing_source_and_guide_are_not_duplicated(self):
        jf=Mock();jf.call.return_value={'TunerHosts':[{'Id':'owned','Type':'m3u','Url':BODY['url']}],
          'ListingProviders':[{'Path':BODY['guide'],'EnabledTuners':['owned']}]}
        with patch.object(live_tv,'check',return_value={'channels':1}): result=live_tv.save(jf,BODY)
        self.assertFalse(result['created'])
        self.assertTrue(all(c.args[0]=='GET' for c in jf.call.call_args_list))
        self.assertNotIn('Url',json.dumps(result))

    def test_partial_save_is_not_retried_or_deleted(self):
        jf=Mock();jf.call.side_effect=[{}, {'Id':'new'}, {}, HttpError(500,'POST','http://jellyfin/LiveTv/ListingProviders')]
        with patch.object(live_tv,'check',return_value={'channels':1}):
            with self.assertRaisesRegex(ValueError,'may already'): live_tv.save(jf,BODY)
        writes=[c for c in jf.call.call_args_list if c.args[0]!='GET']
        self.assertEqual(len(writes),2)
        self.assertTrue(all(c.kwargs['retries']==0 for c in writes))
        self.assertEqual(writes[1].kwargs['body']['EnabledTuners'],['new'])

    def test_invalid_addresses_and_limits(self):
        for value in ['file:///etc/passwd','https://user:pass@example.com/list','https://provider.example:bad']:
            with self.assertRaises(ValueError): live_tv.address(value)
        for limit in [-1,0,21,'bad']:
            with self.assertRaises(ValueError):live_tv.settings(dict(BODY,connections=limit))

    def test_hdhomerun_metadata(self):
        with patch.object(live_tv,'metadata',return_value=(b'[{"GuideName":"Local"}]',False)) as fetch:
            self.assertEqual(live_tv.check({'kind':'hdhomerun','url':'192.0.2.100'})['channels'],1)
        self.assertEqual(fetch.call_args.args[0],'http://192.0.2.100/lineup.json')

    def test_no_https_downgrade(self):
        from urllib.request import Request
        with self.assertRaises(ValueError):
            live_tv._Redirect().redirect_request(Request('https://provider.example/list'),None,302,'',{},'http://provider.example/list')

if __name__ == '__main__':unittest.main()
