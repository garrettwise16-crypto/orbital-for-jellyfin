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
