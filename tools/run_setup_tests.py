"""Run setup tests with the repository's verified web payload in a temporary directory."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='orbital-setup-tests-') as temp:
    payload = Path(temp)
    web = payload / 'fpmigrate/orbital_layer'
    web.mkdir(parents=True)
    manifest = {'layer': 'orbital-public', 'edition': 'customer', 'supportedJellyfin': ['12.0', '12.2', '12.4'], 'files': {}}
    entries = [line.split() for line in (ROOT / 'web/SHA256SUMS').read_text().splitlines()]
    for name in ('LICENSE', 'README.md'):
        entries.append([hashlib.sha256((ROOT / 'web' / name).read_bytes()).hexdigest(), name])
    for pin, name in entries:
        src = ROOT / 'web' / name
        assert hashlib.sha256(src.read_bytes()).hexdigest() == pin, name
        logical = src.name.replace('orbital-customer', 'customer')
        filename = pin[:12] + '-' + logical
        shutil.copyfile(src, web / filename)
        manifest['files'][logical] = {'file': filename, 'sha256': pin, 'bytes': src.stat().st_size}
    (web / 'manifest.json').write_text(json.dumps(manifest), encoding='utf-8')
    env = dict(os.environ, ORBITAL_SETUP_PAYLOAD=str(payload))
    result = subprocess.run([sys.executable, '-m', 'unittest', 'discover', '-s', str(ROOT / 'setup/tests'), '-q'], env=env)
    sys.exit(result.returncode)
