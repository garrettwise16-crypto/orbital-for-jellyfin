"""Read one bounded metadata page through the administrator's connected Seerr."""
from urllib.parse import urlencode
import integrations
from experience_transport import FixedJsonGet

PROVIDERS = {'apple-tv': [350], 'netflix': [8, 1796], 'disney-plus': [337],
             'hulu': [15], 'max': [1899], 'prime-video': [9, 2100],
             'peacock': [386, 387], 'paramount-plus': [2303, 2616, 531]}

def page(provider, kind, number):
    if provider not in PROVIDERS or kind not in ('movies', 'tv'):
        raise ValueError('Choose a supported service and title type')
    if type(number) is not int or not 1 <= number <= 500:
        raise ValueError('Invalid catalogue page')
    cfg = integrations.load()['requests']
    if not cfg.get('enabled') or not cfg.get('key'):
        raise ValueError('Save and check your Seerr connection first')
    query = urlencode({'watchRegion': 'US', 'watchProviders': '|'.join(map(str, PROVIDERS[provider])),
                       'sortBy': 'popularity.desc', 'page': number})
    transport = FixedJsonGet(cfg['url'], header='X-Api-Key', timeout=15, max_bytes=2_000_000)
    result = transport(cfg['url'] + '/api/v1/discover/' + kind + '?' + query, cfg['key'])
    if not isinstance(result, dict) or not isinstance(result.get('results'), list):
        raise ValueError('Seerr did not return a catalogue page')
    total = result.get('totalPages')
    if type(total) is not int or not 0 <= total <= 500 or len(result['results']) > 100:
        raise ValueError('Catalogue exceeds the supported page limit; the saved catalogue was kept')
    return {'results': result['results'], 'totalPages': total}
