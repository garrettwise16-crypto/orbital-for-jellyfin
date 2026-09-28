"""Pairing games with the viewer's own Live TV channels (no network)."""
import unittest
import server


def event(eid, networks, state='live', start='2026-09-28T23:15Z'):
    return {'id': eid, 'league': 'NFL', 'state': state, 'start': start, 'broadcasts': networks, 'teams': []}


CHANNELS = [{'Id': 'c1', 'Name': 'ESPN HD'}, {'Id': 'c2', 'Name': 'ESPNU'}, {'Id': 'c3', 'Name': '206 FS1'},
            {'Id': 'c4', 'Name': 'WFLD'}, {'Id': 'c5', 'Name': 'NBC News NOW'}]


class NetworkKey(unittest.TestCase):
    def test_normalizes_suffixes_numbers_and_aliases(self):
        for raw, want in [('ESPN HD', 'espn'), ('ESPN - TV channel', 'espn'), ('206 FS1', 'fox sports 1'),
                          ('Big Ten Network (HD)', 'big ten network'), ('ESPNU', 'espnu'), ('FOX East', 'fox')]:
            self.assertEqual(server.network_key(raw), want, raw)


class AttachChannels(unittest.TestCase):
    def test_exact_network_match_never_prefix(self):
        [e] = server.attach_channels([event('1', ['ESPN'])], CHANNELS, aliases={})
        self.assertEqual([s['id'] for s in e['sources']], ['c1'])   # not ESPNU
        self.assertEqual(e['feed_status'], 'available')
        self.assertEqual(e['carriers'], ['c1'])

    def test_alias_and_call_sign(self):
        aliases = server.channel_aliases('WFLD=FOX')
        [e] = server.attach_channels([event('1', ['FOX', 'FS1'])], CHANNELS, aliases=aliases)
        self.assertEqual([s['id'] for s in e['sources']], ['c4', 'c3'])

    def test_no_channel_and_finished_games(self):
        events = server.attach_channels([event('1', ['Peacock']), event('2', ['ESPN'], state='final')], CHANNELS, aliases={})
        by_id = {e['id']: e for e in events}
        self.assertEqual(by_id['1']['feed_status'], 'none')
        self.assertEqual(by_id['2']['feed_status'], 'ended')
        self.assertEqual(by_id['2']['sources'], [])

    def test_live_games_sort_first(self):
        events = server.attach_channels([event('late', [], state='scheduled', start='2026-09-28T20:00Z'),
                                         event('now', [], state='live', start='2026-09-28T23:00Z')], [], aliases={})
        self.assertEqual([e['id'] for e in events], ['now', 'late'])


class Normalize(unittest.TestCase):
    def test_broadcasts_are_kept(self):
        raw = {'id': '401', 'date': '2026-09-28T23:15Z', 'name': 'Philadelphia Eagles at Chicago Bears',
               'status': {'type': {'state': 'pre', 'shortDetail': '9/28 - 7:15 PM'}},
               'competitions': [{'competitors': [], 'broadcasts': [{'names': ['ESPN', 'ABC']}],
                                 'geoBroadcasts': [{'media': {'shortName': 'ESPN'}}]}]}
        self.assertEqual(server.normalize(raw, 'NFL')['broadcasts'], ['ESPN', 'ABC'])


if __name__ == '__main__':
    unittest.main()
