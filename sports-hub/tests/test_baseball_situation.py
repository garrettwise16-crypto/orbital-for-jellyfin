"""Sept 27: live baseball situation (count, outs, runners) passes through for the Sports board cards."""
import unittest
import tracker


def raw(situation, state='in'):
    return {'header': {'id': '401', 'competitions': [{'id': '401', 'status': {'type': {'state': state, 'shortDetail': 'Top 6th'}},
                                          'competitors': [{'id': '1', 'homeAway': 'away', 'team': {'id': '1', 'abbreviation': 'NYM'}},
                                                          {'id': '2', 'homeAway': 'home', 'team': {'id': '2', 'abbreviation': 'WSH'}}]}]},
            'plays': [], 'situation': situation}


class BaseballSituation(unittest.TestCase):
    def test_count_outs_runners(self):
        out = tracker.normalize(raw({'balls': 2, 'strikes': 1, 'outs': 2, 'onFirst': {'playerId': 5}, 'onThird': {'playerId': 7},
                                     'batter': {'playerId': 1, 'athlete': {'shortName': 'F. Lindor'}}}), 'MLB', '401')
        s = out.get('situation')
        self.assertIsNotNone(s)
        self.assertEqual((s['balls'], s['strikes'], s['outs']), (2, 1, 2))
        self.assertEqual((s['on_first'], s['on_second'], s['on_third']), (True, False, True))
        self.assertEqual(s['batter'], 'F. Lindor')
        self.assertIsNone(s['pitcher'])

    def test_not_live_has_no_situation(self):
        out = tracker.normalize(raw({'balls': 1, 'strikes': 0, 'outs': 0}, state='post'), 'MLB', '401')
        self.assertNotIn('situation', out)


if __name__ == '__main__':
    unittest.main()
