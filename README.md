# Orbital for Jellyfin

Orbital makes a self-hosted Jellyfin server feel like a streaming service: a cinematic web interface, plus a live sports layer with scores, game centers and play-by-play trackers matched to the channels you already have.

It's built as separate pieces. Use one, some or all of them; each works without the others, and each can be removed again.

| Piece | What it gives you | Folder | Setup |
|---|---|---|---|
| **Web interface** | A new look for Jellyfin in the browser: artwork-led Home, library rows, search, Live TV and guide, Sports and game centers. Stock Jellyfin is one click away. | [`web/`](web/) | [5 min](docs/INSTALL.md#web-interface) |
| **sports-hub** | A small service: today's games for the NFL, college football, MLB, NBA, WNBA, NHL, MLS and UFC; live scores, trackers and previews; and which of your channels carries each game. | [`sports-hub/`](sports-hub/) | [10 min](docs/INSTALL.md#sports-hub) |
| **Team logos** | Real team logos and colors in the sports screens, instead of initials. | [`tools/make_team_art.py`](tools/make_team_art.py) | [2 min](docs/LOGOS.md) |
| **Orbital Phone and TV** | Native playback, episode selection, channels and sports trackers on Android, Android TV and Google TV. | [`native/`](native/) | [Preview downloads and source](native/README.md) |

Common combinations:

- **Just a nicer Jellyfin:** the web interface alone. Sports stays hidden.
- **The full experience:** web interface + sports-hub + team logos.
- **Sports data for your own app or dashboard:** sports-hub alone. It's a plain JSON API that uses Jellyfin sign-ins.

## Guided setup

[Download Orbital Setup for Windows](https://github.com/garrettwise16-crypto/orbital-for-jellyfin/releases/tag/setup-v0.2.0-preview.2). Open `OrbitalSetup.exe` to start the workflow. It is an unsigned preview; release notes include its checksum and current validation limits.

**Orbital Setup is an interactive workflow**, for a new Jellyfin server or an existing one. It explains each action, runs selected installation steps, checks the result, and lets you retry a failed feature without starting over. Choose the web interface, Sports, or both; library setup and Plex migration are optional.

The Windows preview can install Jellyfin through Windows Package Manager, then walk through the first administrator account, media folders, selected features, and your sports sources. Existing servers skip the server installer. Changes requiring a server restart are explained before applying them.

On the final screen, choose **Save and check sources** before **Open Jellyfin**. Unsaved changes block opening Jellyfin and tell you what to save. A source that cannot answer is shown as a problem, not marked ready.

You can also connect Seerr for requests and service catalogues. Save and check its connection, select one catalogue or all supported services, then watch setup download, validate and save the listings. No JSON export is required. Listings currently cover the US; run the connection step again to refresh them. They add discovery metadata, not subscriptions or video.

Source and reproducible build instructions: [`setup/`](setup/). This preview has automated workflow and packaged-app checks; a clean Windows installation and administrator-prompt journey still need real-machine acceptance. Native preview APKs and their corresponding source are linked in [`native/`](native/). Full physical acceptance and switching-speed validation remain open.

## Manual quick start

```bash
git clone https://github.com/garrettwise16-crypto/orbital-for-jellyfin.git
cd orbital-for-jellyfin

# Web interface (point --web-dir at the folder containing Jellyfin's index.html)
sudo python3 tools/install_web.py --web-dir /usr/share/jellyfin/web

# Team logos (optional)
python3 tools/make_team_art.py
sudo python3 tools/install_web.py --web-dir /usr/share/jellyfin/web --team-art team-art.js

# sports-hub (optional): then add one /sports/api/ route to your reverse proxy
cd sports-hub && cp .env.example .env && docker compose up -d --build
```

Reload Jellyfin in the browser. Remove the web interface any time with `--uninstall`.

[docs/INSTALL.md](docs/INSTALL.md) has the full steps for Windows and Docker, plus Caddy and nginx examples.

## What you set up yourself

Some things can't be included in this repository, because they belong to someone else or need your own account. They are optional. Some providers require an API key or your agreement to their terms. The guided Sports plugin starts with your own guide and sources you explicitly connect.

| Thing | Why it isn't included | What to do |
|---|---|---|
| Team logos | Trademarks of the leagues and teams | [Two commands](docs/LOGOS.md) link ESPN's logos from each viewer's browser |
| Sports data | Belongs to the data provider | In guided setup, connect your chosen provider, feed, or opt-in source. The legacy Docker sports-hub reads ESPN public data; review its [details and caveats](docs/DATA-SOURCES.md#espns-public-data) before choosing that deployment. |
| TV channels and guide | Need your own tuner or subscriptions | Set up Live TV in Jellyfin; a guide service such as Schedules Direct is optional ([how](docs/DATA-SOURCES.md#tv-channels-and-guide)) |
| Antenna channels named by call sign | Only you know your local stations | One line in `sports-hub/.env` ([how](docs/DATA-SOURCES.md#matching-games-to-your-channels)) |

## Free and Orbital Plus

Everything here is free, with nothing locked. **Orbital Plus**, an optional paid add-on with a picture-timed tracker, is planned for later. It isn't in this repository, and nothing here depends on it. See [docs/PLUS.md](docs/PLUS.md).

## Ground rules

- **No media sources.** Orbital shows what your Jellyfin server already has and what your Jellyfin permissions allow. It doesn't find, scrape or relay streams.
- **Nothing private.** `tools/scan_public.py` fails the build on addresses, hostnames, personal names, local paths, credentials or private source names. It runs in CI on every push.
- **Not affiliated** with the Jellyfin project, ESPN, any league or any team.

## License

- **Original code** (sports-hub, tools): [MIT](LICENSE).
- **Web interface:** GPL-2.0 ([web/LICENSE](web/LICENSE)), because it builds on jellyfin-web.
- **Phone and Android TV apps:** GPL-2.0; original notices accompany each source archive.
