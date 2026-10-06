"""Fail-closed leak scanner for the public repository. Exit code 1 on any finding.

Checks every tracked text file for private hosts/addresses, personal names, local paths, credentials and
private media-source names; rejects binaries, large files and unexpected file types. There is no
per-line ignore: a legitimate match must be allowed by editing ALLOW below in a reviewed commit.

  python tools/scan_public.py [root]
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[1])
TEXT = {'.py', '.md', '.yml', '.yaml', '.toml', '.txt', '.json', '.example', '.cfg', '.ini', '.js', '.css', '.html',
        '.kt', '.java', '.xml', '.gradle', '.kts', '.sh', '.gitignore', '.dockerignore', ''}
SKIP_DIRS = {'.git', '__pycache__', '.pytest_cache', 'node_modules', '.venv'}
MAX_BYTES = 400_000

RULES = {
    'public or LAN address': r'\b(?:50\.27\.40\.203|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b',
    'private hostname': r'sslip\.io|nip\.io|\.local\b|mini-?itx',
    'personal name': r'\b(?:garrett|garre|nana|logan|awise\d*|wise16)\b',
    'email address': r'[A-Za-z0-9._%+-]+@(?!example\.(?:com|org))[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
    'local path': r'[A-Za-z]:\\\\?Users|/srv/|/mnt/[a-z]/|\\\\wsl|riven-ubuntu|AppData',
    'private media source': r'\b(?:trex|rebel(?:[-_ ]?iptv)?|sportsurge|streameast|real-?debrid|torrentio|jackett|zilean|mediafusion|'
                            r'dispatcharr|teamarr|riven|prowlarr|xtream|player_api\.php|m3u8?\b)',
    'credential': r'(?i)(?:api[_-]?key|access[_-]?token|secret|password)\s*[=:]\s*["\']?[A-Za-z0-9/+_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|'
                  r'\b[0-9a-f]{32}\b',
    'agent handoff': r'\bAGENTS\.md\b|handoff|receipt\.json',
    # Proprietary FlarePaths technology (MomentLock: viewer-picture synchronization; SignalTrust: source
    # semantic trust and failure domains). It lives only in the private FlarePaths repository; see the
    # release plan section 7. Public trackers show the latest reported state only.
    'proprietary FlarePaths technology': r'\b(?:moment[-_ ]?lock|signal[-_ ]?trust|flare[-_ ]?paths?)\b|'
        r'picture[_-]?(?:estimate|match|capture|clock|service|worker)|layout[_-]?adapters?|scorebug|AutomaticMlbPicture|'
        r'OffsetWindow|NativePictureCapture|PlaybackTiming|TrackerSync|autosync|feed[_-]?evidence|source[_-]?(?:graph|eligibility|choices)|'
        r'admission[_-]?broker|failure[_-]?domain|presentation[_-]?coordinate|media[_-]?coordinate|requestVideoFrameCallback',
}
# (rule, file glob, regex on the matched text) combinations reviewed as legitimate.
ALLOW = [
    ('credential', '*.example', r'.*'),  # documented placeholders only
]


def allowed(rule, path, text):
    return any(r == rule and path.match(g) and re.fullmatch(t, text) for r, g, t in ALLOW)


def main():
    findings = []
    for path in sorted(p for p in ROOT.rglob('*') if p.is_file()):
        rel = path.relative_to(ROOT)
        if any(part in SKIP_DIRS for part in rel.parts):
            continue
        if rel.as_posix() == 'tools/scan_public.py':
            continue  # the rules themselves
        suffix = path.suffix if path.suffix else ('.' + path.name.split('.')[-1] if path.name.startswith('.') else '')
        if path.suffix.lower() in ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.apk', '.zip', '.sqlite3', '.db', '.jks', '.keystore'):
            findings.append((rel, 0, 'binary/private file type', path.suffix))
            continue
        if path.stat().st_size > MAX_BYTES:
            findings.append((rel, 0, 'file too large', str(path.stat().st_size)))
            continue
        if path.suffix.lower() not in TEXT and suffix not in TEXT and path.name not in ('Dockerfile', 'LICENSE'):
            findings.append((rel, 0, 'unexpected file type', path.suffix or path.name))
            continue
        try:
            lines = path.read_text(encoding='utf-8').splitlines()
        except UnicodeDecodeError:
            findings.append((rel, 0, 'not UTF-8 text', ''))
            continue
        for n, line in enumerate(lines, 1):
            for rule, pattern in RULES.items():
                for m in re.finditer(pattern, line, re.I):
                    if not allowed(rule, rel, m[0]):
                        findings.append((rel, n, rule, m[0][:40]))
    for rel, n, rule, text in findings:
        print(f'{rel}:{n}: {rule}: {text!r}')
    print(f'{len(findings)} finding(s) in {ROOT}')
    return 1 if findings else 0


if __name__ == '__main__':
    sys.exit(main())
