import unittest
from unittest.mock import patch
import server

class StatusTests(unittest.TestCase):
    def request(self, token):
        handler = object.__new__(server.Handler)
        handler.path = '/sports/api/status'
        handler.token = lambda: token
        replies = []
        handler.respond = lambda code, data: replies.append((code, data))
        with patch.object(server, 'get_json', return_value={'Id': 'test-user'}) as upstream:
            handler.do_GET()
        return replies, upstream

    def test_requires_sign_in(self):
        replies, upstream = self.request(None)
        self.assertEqual(replies[0][0], 401)
        upstream.assert_not_called()

    def test_checks_jellyfin_identity_before_advertising(self):
        replies, upstream = self.request('test-session')
        self.assertEqual(replies, [(200, {'sports': True, 'version': 'public-web-1', 'watched_game': 'estimated'})])
        upstream.assert_called_once_with(server.JELLYFIN + '/Users/Me', 'test-session')

    def test_forwards_token_in_the_form_jellyfin_12_accepts(self):
        # Stock Jellyfin 12 answers 401 to the legacy X-Emby-Token header.
        seen = []
        class Reply:
            def __enter__(self): return self
            def __exit__(self, *a): return False
            def read(self, n): return b'{}'
        with patch.object(server.urllib.request, 'urlopen', lambda request, timeout: seen.append(request) or Reply()):
            server.get_json(server.JELLYFIN + '/Users/Me', 'abc')
        self.assertEqual(seen[0].get_header('Authorization'), 'MediaBrowser Token="abc"')
        self.assertIsNone(seen[0].get_header('X-emby-token'))
