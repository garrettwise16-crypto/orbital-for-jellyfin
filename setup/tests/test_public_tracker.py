"""Exercise the real public formatter and all embedded module integrity checks offline."""
import copy
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'sports_service/app'))
import estimated_view


def fixture():
    first = {'event_id': 'pitch-one', 'sequence': 1, 'phase': 'pitch', 'report_at': 100,
             'row_revision': 'one', 'state_after': {'state': 'live', 'phase': 'pitch', 'period': 1,
             'half': 'top', 'balls': 1, 'strikes': 0, 'outs': 0, 'away': 0, 'home': 0},
             'detail': {'text': 'Ball', 'pitch': True}}
    second = copy.deepcopy(first)
    second.update(event_id='pitch-two', sequence=2, report_at=200)
    second['state_after'].update(balls=2, away=1)
    return {'game_snapshot': {'game_id': '123', 'league': 'MLB', 'source_health': 'fresh', 'revision': 1,
            'teams': [{'id': 'a', 'side': 'away', 'name': 'Away'}, {'id': 'h', 'side': 'home', 'name': 'Home'}],
            'events': [first, second]}}


class PublicTrackerTests(unittest.TestCase):
    def test_runtime_modules_import_and_free_view_has_no_future_scores(self):
        model = fixture()
        result = estimated_view.project(model, 150)['render_model']
        self.assertEqual(result['selected_event_id'], 'pitch-one')
        self.assertEqual([t['score'] for t in result['teams']], ['0', '0'])
        self.assertEqual(len(result['timeline']), 1)
        self.assertEqual(model, fixture())

    def test_unwatched_game_is_latest_reported(self):
        result = estimated_view.project(fixture())
        self.assertEqual(result['label'], 'Latest reported')
        self.assertEqual(result['render_model']['selected_event_id'], 'pitch-two')

    def test_before_first_event_hides_counts_and_scores(self):
        result = estimated_view.project(fixture(), 50)['render_model']
        self.assertIsNone(result['selected_event_id'])
        self.assertTrue(all('score' not in t for t in result['teams']))
        self.assertNotIn('balls', result['situation'])

    def test_missing_source_timestamps_are_not_fabricated(self):
        result = estimated_view.project({'state': 'live'}, 50)
        self.assertFalse(result['timing_available'])
        self.assertIn('timing unavailable', result['label'])
        self.assertEqual(result['manual_choices'], [])

    def test_invalid_cutoff_is_rejected(self):
        for cutoff in (float('nan'), float('inf'), -1, 10**30):
            with self.assertRaises(ValueError): estimated_view.project(fixture(), cutoff)
