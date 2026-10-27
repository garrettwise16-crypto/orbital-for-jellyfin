"""Install or remove the Orbital web interface on a Jellyfin web folder (standard library only).

  python tools/install_web.py --web-dir /usr/share/jellyfin/web              # install or update
  python tools/install_web.py --web-dir /usr/share/jellyfin/web --uninstall  # remove exactly what was added
  python tools/install_web.py --web-dir DIR --team-art team-art.js           # also install team logos (docs/LOGOS.md)
  python tools/install_web.py --web-dir DIR --no-team-art                    # remove installed team logos

What it does:
- keeps a one-time backup of index.html (index.html.orbital-backup)
- copies web/dist into <web-dir>/orbital/ and records every file it wrote in orbital/.orbital-installed.json
- adds one marked block (<!-- orbital:begin --> ... <!-- orbital:end -->) to index.html, before Jellyfin's scripts
- on --uninstall removes that block and only the files it recorded; anything else in the folder is left alone
It never touches media, accounts or Jellyfin settings. Jellyfin upgrades replace index.html: run it again afterwards.
"""
import argparse, hashlib, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DIST = REPO / 'web' / 'dist'
BEGIN, END = '<!-- orbital:begin -->', '<!-- orbital:end -->'
MARKER = '.orbital-installed.json'


def fail(message):
    sys.exit('install_web: ' + message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


# index.html is read and written with newline='' so its bytes are kept exactly as they were, on every OS.
def read(path):
    with open(path, encoding='utf-8', newline='') as f:
        return f.read()


def write(path, text):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(text)


def block(team_art):
    lines = [BEGIN, '<script src="orbital/orbital-customer.js"></script>']
    if team_art:
        lines.append('<script src="orbital/team-art.js"></script>')
    lines += ['<link rel="stylesheet" href="orbital/orbital.css">',
              '<link rel="stylesheet" href="orbital/live-tv.css">',
              '<link rel="stylesheet" href="orbital/orbital-customer.css">',
              '<script defer src="orbital/orbital.js"></script>',
              '<script defer src="orbital/live-tv.js"></script>',
              '<script defer src="orbital/phone.js"></script>',
              END]
    return '\n'.join(lines) + '\n'


def strip_block(text):
    pattern = re.compile(re.escape(BEGIN) + r'.*?' + re.escape(END) + r'\n?', re.S)
    found = len(pattern.findall(text))
    if found > 1:
        fail('index.html has more than one Orbital block; restore index.html.orbital-backup first')
    return pattern.sub('', text), found == 1


def install(web, team_art, keep_team_art):
    index = web / 'index.html'
    text = read(index)
    if 'jellyfin' not in text.lower():
        fail(f'{index} does not look like Jellyfin\'s web client')
    target = web / 'orbital'
    marker = target / MARKER
    previous = json.loads(marker.read_text(encoding='utf-8')) if marker.exists() else None
    if target.exists() and previous is None:
        fail(f'{target} exists and was not created by this tool; not overwriting it')
    clean, _ = strip_block(text)
    backup = web / 'index.html.orbital-backup'
    if not backup.exists():
        write(backup, clean)
    files = {p.name: p.read_bytes() for p in sorted(DIST.iterdir()) if p.is_file()}
    if not files:
        fail(f'nothing to install in {DIST}')
    if team_art:
        files['team-art.js'] = Path(team_art).read_bytes()
    elif keep_team_art and previous and (target / 'team-art.js').is_file():
        files['team-art.js'] = (target / 'team-art.js').read_bytes()
    first_script = re.search(r'<script\b', clean, re.I)
    head_end = re.search(r'</head>', clean, re.I)
    at = first_script.start() if first_script else head_end.start() if head_end else None
    if at is None:
        fail('index.html has no <script> or </head> to insert before')
    target.mkdir(exist_ok=True)
    for name in (previous or {}).get('files', {}):
        if name not in files and (target / name).is_file():
            (target / name).unlink()
    for name, data in files.items():
        (target / name).write_bytes(data)
    write(index, clean[:at] + block('team-art.js' in files) + clean[at:])
    marker.write_text(json.dumps({'files': {n: sha(d) for n, d in files.items()}}, indent=1), encoding='utf-8')
    print(f'Installed {len(files)} files into {target} and added the Orbital block to {index}.')
    print('Reload Jellyfin in the browser. Add ?orbital=off before the # in the address to see stock Jellyfin.')


def uninstall(web):
    index = web / 'index.html'
    target = web / 'orbital'
    marker = target / MARKER
    clean, had = strip_block(read(index))
    if had:
        write(index, clean)
    removed = 0
    if marker.exists():
        for name in json.loads(marker.read_text(encoding='utf-8')).get('files', {}):
            if (target / name).is_file():
                (target / name).unlink()
                removed += 1
        marker.unlink()
        if target.exists() and not any(target.iterdir()):
            target.rmdir()
    backup = web / 'index.html.orbital-backup'
    if backup.exists() and read(backup) == clean:
        backup.unlink()
    print(f'Removed the Orbital block ({"found" if had else "not present"}) and {removed} installed files.')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--web-dir', required=True, help="Jellyfin's web folder (the one containing index.html)")
    parser.add_argument('--uninstall', action='store_true')
    parser.add_argument('--team-art', help='team-art.js made by tools/make_team_art.py')
    parser.add_argument('--no-team-art', action='store_true', help='remove team logos installed earlier')
    args = parser.parse_args()
    web = Path(args.web_dir)
    if not (web / 'index.html').is_file():
        fail(f'no index.html in {web}')
    if args.uninstall:
        uninstall(web)
    else:
        install(web, args.team_art, not args.no_team_art)


if __name__ == '__main__':
    main()
