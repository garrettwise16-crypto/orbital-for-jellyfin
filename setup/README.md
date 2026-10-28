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

## Watching away from home

The optional **Watch away from home** workflow recommends a normal HTTPS address usable in stock Jellyfin, Orbital, or a browser. It checks the local server, walks through choosing an existing domain or a free DuckDNS name, installs Caddy through Windows Package Manager, and requests ordinary Windows administrator approval. Setup creates an owned automatic-start service, certificate storage, and a program-specific firewall rule. DuckDNS updates run automatically; the account token is encrypted with Windows DPAPI and restricted to administrators and SYSTEM.

The workflow displays this computer's address and the two router forwarding entries needed (TCP 80 and 443), opens the router page when detected, and checks the certificate and Jellyfin server identity. Router forwarding is guided, not automatically applied: different routers and ISP restrictions require the owner's action. Jellyfin's internal port should not be forwarded. A mobile-data playback step completes the journey; its confirmation is explicitly owner-reported, not an independent external probe.

When incoming connections are unavailable, the private Tailscale connection remains available. Switching the option alone does not remove an existing public connection; use **Remove this managed HTTPS connection** first if that is intended. Removal affects only the owned service, address-update task and firewall rule, and restores unchanged Jellyfin settings. Router entries must be removed manually. Modified or unrelated proxy configurations are preserved.

The automatic Windows path currently requires a local HTTP Jellyfin server without a base path and the standard ProgramData location. Existing HTTPS installations can use the separate address-check action. Setup never changes networking merely by opening the page.

### Validation limits

The workflow is tested against isolated Jellyfin API fixtures, including first-run setup, feature retries, folder selection, and unsaved provider settings. The packaged executable is checked using disposable web files and a temporary profile. A clean Windows machine installation and its administrator prompts still require physical acceptance. Those checks are distinct from the automated tests.

The source in this folder and its original service/plugin code use the repository MIT license. Bundled web files retain their GPL-2.0 license. Upstream runtime notices are in `notices/`. Optional paid implementations are not included.
