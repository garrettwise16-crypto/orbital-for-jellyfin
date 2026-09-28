"""Sept 26 drive chart regressions (no network)."""
import unittest
import tracker

A, B = '2641', '2534'


def play(pid, start_team, a, end_team, b, yards=0, text='play'):
    return {'id': pid, 'text': text, 'statYardage': yards,
            'start': {'team': {'id': start_team}, 'yardsToEndzone': a, 'down': 1, 'distance': 10, 'downDistanceText': '1st & 10'},
            'end': {'team': {'id': end_team}, 'yardsToEndzone': b}}


PUNT = {'id': 'd1', 'team': {'id': A}, 'displayResult': 'Punt', 'yards': 3, 'offensivePlays': 3,
        'plays': [play('1', A, 89, A, 87, 2), play('2', A, 87, A, 86, 1), play('3', A, 86, B, 60, 0, 'punt')]}
PICK = {'id': 'd2', 'team': {'id': B}, 'displayResult': 'Interception', 'yards': 20, 'offensivePlays': 2,
        'plays': [play('4', B, 60, B, 40, 20), play('5', B, 40, A, 90, 0, 'intercepted')]}
LIVE = {'id': 'd3', 'team': {'id': A}, 'yards': 5, 'offensivePlays': 2,
        'plays': [play('6', A, 90, A, 85, 5), play('7', A, 85, A, 85, 0, 'pass incomplete')]}
RAW = {'drives': {'previous': [PUNT, PICK, LIVE], 'current': LIVE}}
CAL = {'verified': True}


class DriveFlow(unittest.TestCase):
    def test_turnover_and_punt_spans_use_the_drive_team_only(self):
        rows = {d['id']: d for d in tracker.drive_flow(RAW, CAL)}
        self.assertAlmostEqual(rows['d1']['start_x'], 0.11); self.assertAlmostEqual(rows['d1']['end_x'], 0.14)   # 3 yards, not 29
        self.assertAlmostEqual(rows['d2']['start_x'], 0.40); self.assertAlmostEqual(rows['d2']['end_x'], 0.60)   # not the end zone

    def test_in_progress_drive_listed_once(self):
        self.assertEqual([d['id'] for d in tracker.drive_flow(RAW, CAL)], ['d1', 'd2', 'd3'])

    def test_ball_spot_only_for_the_current_drive(self):
        field, _, plays, _, _ = tracker.football(RAW, CAL, 'e')
        self.assertAlmostEqual(field['ball_x'], 0.15); self.assertEqual(len(plays), 2)
        done = {'drives': {'previous': [PUNT, PICK]}}
        self.assertNotIn('ball_x', tracker.football(done, CAL, 'e')[0])


class AdminPlays(unittest.TestCase):
    def test_timeout_is_listed_but_not_drawn(self):
        t = play('8', A, 85, A, 85, 0, 'Timeout Texas Tech'); t['type'] = {'text': 'Timeout'}
        live = dict(LIVE, plays=LIVE['plays'] + [t])
        _, _, plays, _, _ = tracker.football({'drives': {'previous': [live], 'current': live}}, CAL, 'e')
        self.assertEqual(len(plays), 3); self.assertNotIn('start_x', plays[-1]); self.assertIn('start_x', plays[0])


if __name__ == '__main__':
    unittest.main()
