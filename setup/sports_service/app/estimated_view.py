"""Public estimated/manual tracker view. Uses reported event times; no screen reading."""
import math
import time


def project(model, cutoff=None):
    """Format one consistent reported state. A missing clock never invents historical facts."""
    now = time.time()
    if cutoff is not None and (not isinstance(cutoff, (float, int)) or not math.isfinite(cutoff) or not 0 < cutoff <= now + 5):
        raise ValueError('Choose a valid tracker time')
    snapshot = model.get('game_snapshot')
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get('events'), list):
        return {'render_model': {'selected_event_id': None, **(model.get('latest_render_model') or model)}, 'label': 'Latest reported · timing unavailable',
                'manual_choices': [], 'timing_available': False, 'server_time': now}
    events = snapshot['events']
    timed = [row for row in events if isinstance(row.get('report_at'), (int, float)) and math.isfinite(row['report_at'])]
    chosen = events if cutoff is None else [row for row in timed if row['report_at'] <= cutoff]
    selected = chosen[-1] if chosen else None
    # Use the public formatter already used by Game Center, with an explicitly bounded history.
    import tracker
    latest = selected['state_after'] if selected else {'state': 'scheduled', 'phase': 'scheduled', 'status': 'Waiting for reported plays'}
    view = {'event': snapshot['game_id'], 'league': snapshot['league'], 'source_health': snapshot['source_health'],
            'game_revision': snapshot['revision'], 'selected': selected, 'events': chosen, 'latest': latest,
            'teams': snapshot['teams'], 'holding': False, 'label': 'Latest reported' if cutoff is None else 'Estimated timing'}
    rendered = tracker._game_snapshot._latest_render.present(view)
    return {'render_model': rendered, 'label': view['label'], 'timing_available': bool(timed), 'server_time': now,
            'manual_choices': [{'event_id': row['event_id'], 'at': row['report_at'],
                                'label': str(row.get('detail', {}).get('text') or row.get('phase') or 'Play')[:350]}
                               for row in timed[-500:]]}
