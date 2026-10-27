"""Build the Windows guided setup, plugin and service from this checkout.

Run with Python3.12 and requirements-build.txt installed. Supply the folder containing
the six Jellyfin12 reference DLLs from your Jellyfin installation. No server is changed.
Generated files live outside the checkout in --output. No signing key is required.
"""
from pathlib import Path
import argparse, hashlib, json, os, shutil, subprocess, sys

B=Path(__file__).resolve().parent
def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def run(*args): subprocess.run(list(map(str,args)),check=True)
def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--jellyfin-reference-dir',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(); out=args.output.resolve(); refs=args.jellyfin_reference_dir.resolve()
    if os.name!='nt': raise SystemExit('The packaged guided setup currently targets Windows.')
    if out.is_relative_to(B.parent): raise SystemExit('Choose an output folder outside the source checkout.')
    required=['MediaBrowser.Controller','MediaBrowser.Model','MediaBrowser.Common','Jellyfin.Data','Jellyfin.Extensions','Jellyfin.Database.Implementations']
    for name in required:
        if not (refs/(name+'.dll')).is_file():raise SystemExit('Missing Jellyfin reference: '+name)
    sources={p.relative_to(B).as_posix():sha(p) for p in B.rglob('*') if p.is_file() and '__pycache__' not in p.parts}
    out.mkdir(parents=True,exist_ok=True)
    plugin=out/'payload/fpmigrate/sports_plugin';plugin.mkdir(parents=True,exist_ok=True)
    run('dotnet','build',B/'plugin/Orbital.Sports/Orbital.Sports.csproj','-c','Release','-o',out/'plugin',
        '-p:JellyfinReferencePath='+str(refs),'-p:BaseIntermediateOutputPath='+str(out/'obj')+os.sep)
    shutil.copyfile(out/'plugin/Orbital.Sports.dll',plugin/'Orbital.Sports.dll')
    service=B/'sports_service/app'
    command=[sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--noconsole','--name','OrbitalSports',
        '--paths',str(service),'--hidden-import','tzdata','--collect-data','tzdata','--distpath',str(out/'service-dist'),
        '--workpath',str(out/'service-work'),'--specpath',str(out)]
    for module in (service/'hidden-imports.txt').read_text().splitlines():
        if module.strip():command+=['--hidden-import',module.strip()]
    run(*command,service/'service.py')
    shutil.copytree(out/'service-dist/OrbitalSports',plugin/'service',dirs_exist_ok=True)
    shutil.copytree(B/'notices',plugin/'notices',dirs_exist_ok=True)
    files={p.relative_to(plugin).as_posix():{'sha256':sha(p),'bytes':p.stat().st_size} for p in plugin.rglob('*') if p.is_file() and p.name!='bundle.json'}
    (plugin/'bundle.json').write_text(json.dumps({'name':'Orbital Sports','version':'1.0.8.0','service':'public.6','files':files},indent=2))
    web=out/'payload/fpmigrate/orbital_layer';web.mkdir(parents=True,exist_ok=True)
    manifest={'layer':'orbital-public','edition':'customer','supportedJellyfin':['12.0','12.2','12.4'],'files':{}}
    for line in (B.parent/'web/SHA256SUMS').read_text().splitlines():
        pin,name=line.split();src=B.parent/'web'/name
        if sha(src)!=pin:raise SystemExit('Web hash mismatch: '+name)
        logical=src.name.replace('orbital-customer','customer');filename=pin[:12]+'-'+logical
        shutil.copyfile(src,web/filename);manifest['files'][logical]={'file':filename,'sha256':pin,'bytes':src.stat().st_size}
    for name in ['LICENSE','README.md']:
        src=B.parent/'web'/name;pin=sha(src);filename=pin[:12]+'-'+name;shutil.copyfile(src,web/filename)
        manifest['files'][name]={'file':filename,'sha256':pin,'bytes':src.stat().st_size}
    (web/'manifest.json').write_text(json.dumps(manifest,indent=2))
    run(sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onefile','--name','OrbitalSetup','--paths',B,
        '--add-data',str(B/'fpmigrate/ui')+';fpmigrate/ui','--add-data',str(web)+';fpmigrate/orbital_layer',
        '--add-data',str(plugin)+';fpmigrate/sports_plugin','--add-data',str(B/'notices')+';notices',
        '--distpath',out/'dist','--workpath',out/'setup-work','--specpath',out,B/'launch.py')
    assert all(sha(B/name)==pin for name,pin in sources.items()),'Source changed during build'
    artifact=out/'dist/OrbitalSetup.exe'
    (out/'build.json').write_text(json.dumps({'source_unchanged':True,'source':sources,'sha256':sha(artifact),'bytes':artifact.stat().st_size},indent=2))
    print('Built',artifact,'SHA256',sha(artifact))
if __name__=='__main__':main()
