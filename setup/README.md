# Orbital Setup

An interactive setup application for new and existing Jellyfin servers. Choose individual features or install the web interface and Sports together. Each action has visible progress, a result check, and recovery instructions. Provider settings must be saved and checked before the final **Open Jellyfin** action.

The Windows preview supports installing Jellyfin through Windows Package Manager, creating the first administrator account, selecting media folders, and installing selected features. It also supports optional migration from Plex. It does not supply media, subscriptions, provider credentials, or team artwork rights.

## Simple and advanced setup

Choose **This Windows PC** for the automated native installer, or **An existing Jellyfin server** to connect without installing another server. The startup check shows free space on the setup profile drive; media and transcode drives can differ. Plex migration proposes libraries and user matches, checks folder access through Jellyfin, previews the changes and verifies copied progress. **Check copied progress again** repeats the readback; actual playback is a separate test.

Advanced users can choose **Docker on Linux** to generate a version-pinned Compose deployment with persistent config/cache and read-only media, or **Debian / Ubuntu** to generate a script that downloads and verifies Jellyfin's official installer before asking for permission to run it. Save and execute these files on the chosen host, then enter its address and choose **Check server**. These paths do not silently install on the Windows PC or fall back to a different server. This Windows application does not automatically install Orbital web/plugin files on remote hosts; compatibility and host-specific GPU configuration remain separate checks. Docker on Windows is not the recommended path.

**Report a problem / tester checklist** is available before setup succeeds. Record movie, resume, episode, subtitle/audio and outside-home checks as Worked, Had a problem or Not tested. Prepare the report, review its preview and save the JSON file for private sharing. It includes the executable fingerprint, platform, server versions, aggregate migration results and your description; it does not automatically collect raw logs, library titles, account names or server addresses. Known credentials and recognizable links are redacted, but review free-text descriptions yourself. Nothing is uploaded. The separate migration CSV contains title/account details.

### Build the Windows app

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

## Server readiness and recovery

Open **Check server readiness, backups and updates** at any step. After connecting, check library access, writable server folders, available local disk space, the current video-conversion configuration and detected Windows graphics hardware. These checks do not enable hardware acceleration or prove playback works.

Create a server-owned database backup, optionally including metadata. Setup verifies the returned archive listing and database manifest. To restore, choose a backup for the same Jellyfin version and type RESTORE. Setup checks that nobody is watching, checks the server identity, and saves a recovery backup of the current database before requesting restoration. Jellyfin restarts: reconnect and check the result. A lost connection is reported as an unknown outcome, never automatically retried. Copies on another drive, media backups and external-service backups remain your responsibility.

**Start over / change server** clears the current connection and unsaved choices without removing installed features or migration history. Saved migrations cannot be applied, verified or undone against a different Jellyfin server.

Problem reports include a bounded operation timeline (operation names, completion states and error categories), retained across Setup restarts. Exception messages, media titles and credentials are not stored in this timeline. Review the report before sharing. **Check published setup releases** opens official release notes; it does not silently upgrade Jellyfin or claim that this unsigned executable is publisher-signed.
