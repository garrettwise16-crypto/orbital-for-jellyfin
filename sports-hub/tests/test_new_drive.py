"""Sept 26: a drive with no snap yet after a kickoff is labelled as a new drive, not missing ESPN data."""
import unittest
import tracker


def raw(previous_located, current_plays):
    team = {'id': '344'}
    def play(pid, typ, y=None):
        p = {'id': pid, 'type': {'text': typ}, 'text': typ, 'start': {'team': team}, 'end': {'team': team}}
        if y is not None:
            p['start']['yardsToEndzone'] = y; p['end']['yardsToEndzone'] = y - 5
        return p
    prev = [{'id': 'd1', 'team': team, 'plays': [play('p1', 'Rush', 60 if previous_located else None)]}]
    cur = {'id': 'd2', 'team': team, 'plays': current_plays}
    return {'header': {'id': '1', 'competitions': [{'id': '1', 'status': {'type': {'state': 'in', 'shortDetail': '7:09 - 4th'}, 'period': 4},
            'competitors': [{'team': {'id': '344', 'displayName': 'Mississippi State'}, 'homeAway': 'home'},
                            {'team': {'id': '142', 'displayName': 'Missouri'}, 'homeAway': 'away'}]}]},
            'drives': {'previous': prev + [cur], 'current': cur}}


class NewDrive(unittest.TestCase):
    def reason(self, r):
        return tracker.normalize(r, 'College football', '1')['unavailable_reason']

    def test_kickoff_only_drive_after_located_drives(self):
        kick = {'id': 'k', 'type': {'text': 'Kickoff'}, 'text': 'Kickoff', 'start': {}, 'end': {}}
        self.assertEqual(self.reason(raw(True, [kick])), 'New drive — the chart starts with the first snap.')

    def test_no_locations_anywhere_keeps_espn_message(self):
        self.assertEqual(self.reason(raw(False, [])), 'ESPN is not sending play locations for this game right now.')

class PenaltyYards(unittest.TestCase):
    def test_yards_follow_ball_spots(self):
        team = {'id': '99'}
        pen = {'id': 'p1', 'type': {'text': 'Penalty'}, 'text': 'pass complete for 22 yards ... PENALTY offense holding 10 yards',
               'statYardage': 10, 'start': {'team': team, 'yardsToEndzone': 58}, 'end': {'team': team, 'yardsToEndzone': 68}}
        cur = {'id': 'd', 'team': team, 'plays': [pen]}
        raw = {'header': {'id': '1', 'competitions': [{'id': '1', 'status': {'type': {'state': 'in'}},
               'competitors': [{'team': {'id': '99', 'displayName': 'LSU'}, 'homeAway': 'home'}, {'team': {'id': '245', 'displayName': 'TAMU'}, 'homeAway': 'away'}]}]},
               'drives': {'previous': [cur], 'current': cur}}
        play = tracker.normalize(raw, 'College football', '1')['plays'][-1]
        self.assertEqual(play['yards'], -10)

class CurrentSituation(unittest.TestCase):
    def test_latest_play_end_state(self):
        team = {'id': '30'}
        rush = {'id': 'r', 'type': {'text': 'Rush'}, 'text': 'rush for 3', 'start': {'team': team, 'yardsToEndzone': 52},
                'end': {'team': team, 'yardsToEndzone': 49, 'down': 1, 'distance': 10, 'possessionText': 'ORE 49', 'downDistanceText': '1st & 10 at ORE 49'}}
        timeout = {'id': 't', 'type': {'text': 'Timeout'}, 'text': 'Timeout', 'start': {'team': team}, 'end': {'team': team, 'down': 0}}
        cur = {'id': 'd', 'team': team, 'plays': [rush, timeout]}
        raw = {'header': {'id': '1', 'competitions': [{'id': '1', 'status': {'type': {'state': 'in'}},
               'competitors': [{'team': {'id': '30', 'displayName': 'USC'}, 'homeAway': 'home'}, {'team': {'id': '2483', 'displayName': 'Oregon'}, 'homeAway': 'away'}]}]},
               'drives': {'previous': [cur], 'current': cur}}
        sit = tracker.normalize(raw, 'College football', '1')['situation']
        self.assertEqual((sit['down'], sit['distance'], sit['spot']), (1, 10, 'ORE 49'))


if __name__ == '__main__':
    unittest.main()
