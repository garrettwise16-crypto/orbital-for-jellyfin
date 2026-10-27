"""Make team-art.js: the table of team logos, short names and colors the Orbital web interface uses.

Orbital ships no team logos (they belong to the leagues and teams). This builds the table on your own machine
from ESPN's public team lists; the logo images themselves stay on ESPN's servers.

  python tools/make_team_art.py                      # all leagues
  python tools/make_team_art.py --leagues NFL,MLB    # only some
  python tools/make_team_art.py --dark               # logos drawn for dark backgrounds

Then install it:  python tools/install_web.py --web-dir <jellyfin web folder> --team-art team-art.js
See docs/LOGOS.md.
"""
import argparse, json, sys, urllib.request
from pathlib import Path

# Must match the league names sports-hub uses (sports-hub/app/server.py LEAGUES).
LEAGUES = {'NFL': 'football/nfl', 'College football': 'football/college-football', 'MLB': 'baseball/mlb',
           'NBA': 'basketball/nba', 'WNBA': 'basketball/wnba', 'NHL': 'hockey/nhl', 'MLS': 'soccer/usa.1'}
TEAMS_URL = 'https://site.api.espn.com/apis/site/v2/sports/{}/teams?limit=1000'
# The web interface only displays logo images from this host.
LOGO_HOST = 'https://a.espncdn.com/'


def team_name(value):
    # Same cleanup sports-hub applies, so keys match the games it returns.
    return (value or '').replace('Athletics Athletics', 'Athletics').strip()


def espn_teams(league, agent):
    request = urllib.request.Request(TEAMS_URL.format(LEAGUES[league]), headers={'User-Agent': agent})
    with urllib.request.urlopen(request, timeout=20) as response:
        data = json.load(response)
    for sport in data.get('sports', []):
        for group in sport.get('leagues', []):
            for entry in group.get('teams', []):
                yield entry.get('team', {})


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--leagues', default=','.join(LEAGUES), help='comma-separated, default all: ' + ', '.join(LEAGUES))
    parser.add_argument('--dark', action='store_true', help="use ESPN's dark-background logo variants")
    parser.add_argument('--out', type=Path, default=Path('team-art.js'))
    parser.add_argument('--user-agent', default='orbital-team-art/1.0')
    args = parser.parse_args()

    table = {}
    for league in [x.strip() for x in args.leagues.split(',') if x.strip()]:
        if league not in LEAGUES:
            sys.exit(f'unknown league {league!r}; choose from {", ".join(LEAGUES)}')
        count = 0
        for team in espn_teams(league, args.user_agent):
            name = team_name(team.get('displayName'))
            if not name:
                continue
            logos = [l for l in team.get('logos', []) if str(l.get('href', '')).startswith(LOGO_HOST)]
            dark = next((l['href'] for l in logos if 'dark' in (l.get('rel') or [])), None)
            entry = {'abbr': team.get('abbreviation') or ''}
            if team.get('color'):
                entry['color'] = team['color'].lstrip('#')  # hex without '#'; the web interface adds it
            url = (args.dark and dark) or (logos[0]['href'] if logos else None)
            if url:
                entry['url'] = url
            table[league + '|' + name] = entry
            count += 1
        print(f'{league}: {count} teams')

    body = json.dumps(table, indent=0, sort_keys=True, ensure_ascii=False)
    args.out.write_text('/* Team logos/short names/colors for Orbital, made by tools/make_team_art.py. */\n'
                        'window.OrbitalTeamArt = Object.assign(window.OrbitalTeamArt || {}, ' + body + ');\n',
                        encoding='utf-8')
    print(f'Wrote {args.out} ({len(table)} teams).')
    print(f'Install with: python tools/install_web.py --web-dir <jellyfin web folder> --team-art {args.out}')


if __name__ == '__main__':
    main()
