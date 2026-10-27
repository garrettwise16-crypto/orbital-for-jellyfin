# Orbital Setup

An interactive setup application for new and existing Jellyfin servers. Choose individual features or install the web interface and Sports together. Each action has visible progress, a result check, and recovery instructions. Provider settings must be saved and checked before the final **Open Jellyfin** action.

The Windows preview supports installing Jellyfin through Windows Package Manager, creating the first administrator account, selecting media folders, and installing selected features. It also supports optional migration from Plex. It does not supply media, subscriptions, provider credentials, or team artwork rights.

## Build the Windows app

Use Python 3.12, the .NET 10 SDK, and the reference assemblies from your supported Jellyfin 12 server installation. The setup executable contains the web layer and Sports plugin; it downloads Jellyfin separately only when requested.

```powershell
python -m venv .venv
.venv/Scripts/python -m pip install -r setup/requirements-build.txt
.venv/Scripts/python setup/build.py --jellyfin-reference-dir C:/JellyfinReferences --output C:/OrbitalBuild
C:/OrbitalBuild/dist/OrbitalSetup.exe
```

The output folder must be outside the repository. `build.json` records the source and executable hashes and verifies that source files did not change during the build. Keep build products, signing keys, account state, and credentials out of Git.

For source development after building, set `ORBITAL_SETUP_PAYLOAD` to the output folder's `payload` directory, then run `python setup/launch.py`. Frozen releases always use their bundled payload. Run the offline setup tests with `python tools/run_setup_tests.py`.

## Validation limits

The workflow is tested against isolated Jellyfin API fixtures, including first-run setup, feature retries, folder selection, and unsaved provider settings. The packaged executable is checked using disposable web files and a temporary profile. A clean Windows machine installation and its administrator prompts still require physical acceptance. Those checks are distinct from the automated tests.

The source in this folder and its original service/plugin code use the repository MIT license. Bundled web files retain their GPL-2.0 license. Upstream runtime notices are in `notices/`. Optional paid implementations are not included.
