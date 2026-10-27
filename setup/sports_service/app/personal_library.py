"""Free per-user library features, using only this server and the viewer's token."""
from pathlib import Path
import os
import threading
import integrations
from experience_http import Config, PREFIX
from experience_live import LiveConnectedService

_lock = threading.Lock()
_service = None
_config = None

def enabled():
    if os.environ.get('ORBITAL_PERSONAL_LIBRARY', '1') != '1': return False
    return integrations.load().get('personal_library',True) if os.environ.get('SPORTS_DATA_DIR') else True

def create(data_dir, jellyfin, fetch, settings=None):
    """No account IDs, tokens, service keys or server addresses are bundled."""
    state = Path(data_dir) / 'personal-library'
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    config = Config(server=jellyfin.rstrip('/'), database=str(state/'personal.sqlite'),
                    enabled=True, all_authenticated_users=True, personal=True,
                    spoilers=True, shelves=True, bookmarks=True, playback_preferences=True)
    return LiveConnectedService(config, fetch, jellyfin,
        seerr_read=integrations.request_bridge(jellyfin.rstrip('/'),settings or {}))

def dispatch(method, path, headers, body, jellyfin, fetch):
    global _service, _config
    if not enabled():
        return 404, {'error': 'personal_library_disabled'}
    data_dir = os.environ.get('SPORTS_DATA_DIR')
    if not data_dir:
        return 503, {'error': 'personal_library_storage_not_configured'}
    with _lock:
        settings=integrations.load()
        if _service is None or settings != _config:
            _service = create(data_dir, jellyfin, fetch, settings)
            _config = settings
    return _service.request(method, path, headers, body)
