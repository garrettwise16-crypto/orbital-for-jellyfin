# Orbital for Jellyfin

Orbital is a set of add-ons that make a self-hosted Jellyfin server feel like a streaming service: a cinematic web interface, an Android TV app and a live sports layer.

**Status:** private staging. It is being prepared piece by piece, and nothing has been published yet.

| Piece | Folder | State |
|---|---|---|
| Live sports: scores, game centers, trackers, favorite teams, pairing games with your own channels | `sports-hub/` | staged; tests and container build |
| Orbital web interface for jellyfin-web | `web/` | not yet staged |
| Orbital TV (Android TV fork of jellyfin-androidtv) | `android-tv/` | not yet staged |

## Ground rules for this repository

- **No media sources.** Orbital shows what your Jellyfin server already has and what your Jellyfin permissions allow. It does not find, scrape or relay streams. Use your own media, an antenna tuner, or services you subscribe to.
- **Nothing private.** `tools/scan_public.py` fails the build on addresses, hostnames, personal names, local paths, credentials or private source names. It runs in CI on every push.

## License

- **Original code** (sports-hub, tools): [MIT](LICENSE). It's short and permissive, and it's the norm for self-hosted add-ons, so anyone can reuse the sports layer in their own setup.
- **Web interface and Android TV app:** these modify jellyfin-web and jellyfin-androidtv, so they will be released under GPL-2.0, as those projects require. Each will carry its own `LICENSE` in its folder.
