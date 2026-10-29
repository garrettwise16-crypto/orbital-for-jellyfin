# Orbital web interface — preview

A responsive Jellyfin web shell with Home, library browsing, Search, Live TV, Sports and Game Center. The Sports quick filters scroll horizontally; All filters opens the full filter dialog.

This preview contains the readable JavaScript and CSS in `dist/` under GPL-2.0 (see LICENSE). It does not include Jellyfin itself, media, team artwork files or a replacement Jellyfin core bundle. Keep Jellyfin's own licensing and notices with your installation.

Baseball trackers show full pitcher and batter names and place pitch/result captions within the animation surface below the plate. A single retained pitch is not duplicated in a history row. Zone close-ups include edge contact and near misses up to four inches outside. These rendering changes do not change the estimated/manual timing model.

## Optional services

Configure the public sports-hub from this repository behind the same origin at `/sports/api/`, or use a compatible Sports plugin. The adapter probes its authenticated status endpoint. Without that service the ordinary media library still works and Sports navigation is hidden. Tracker responses with or without a game snapshot are supported. Missing optional services are answered locally as unavailable.

Game Center and other non-watched trackers request the latest reported state every second while visible, subject to source availability. They do not use the watched-video delay; animation durations and repeated-update deduplication are preserved. Player tracking for the game being watched uses an estimated delay and manual adjustment. It does not read the video picture or establish broadcast synchronization. Missing geometry is not invented. Optional historical geometry providers are absent in this edition. The default personal-library service, catalogue, external requests and custom downloads are disabled.

## Try it on a test Jellyfin installation

The easiest way is the installer, which does the steps below and can undo them: `python3 tools/install_web.py --web-dir <folder containing Jellyfin's index.html>`. See [docs/INSTALL.md](../docs/INSTALL.md). For team logos, see [docs/LOGOS.md](../docs/LOGOS.md).

To do it by hand: back up the test server's `index.html`. Copy the contents of `dist/` into a new `orbital/` directory alongside it. Before Jellyfin's scripts in the HTML head, add the following in this order (prefix the paths with your Jellyfin base URL if configured):

```html
<script src="/web/orbital/orbital-customer.js"></script>
<link rel="stylesheet" href="/web/orbital/orbital.css">
<link rel="stylesheet" href="/web/orbital/live-tv.css">
<link rel="stylesheet" href="/web/orbital/orbital-customer.css">
<script defer src="/web/orbital/orbital.js"></script>
<script defer src="/web/orbital/live-tv.js"></script>
<script defer src="/web/orbital/phone.js"></script>
```

Keep the original Jellyfin scripts and styles. Reload at a convenient break. To temporarily bypass the shell, use `?orbital=off` before the URL hash. To remove it, restore your backed-up index and remove only the added directory. Jellyfin upgrades may replace the index, requiring reapplication. Do not overwrite an existing directory owned by another extension.

The adapter discovers stock Jellyfin's playback manager; compatibility depends on the Jellyfin web version. The current preview has browser navigation checks at desktop and mobile sizes, plus automated clock and service-contract tests. These checks do not establish physical TV/phone acceptance or complete playback compatibility with every Jellyfin version. Test playback on your own test installation before household deployment.

## Checks

From the repository root:

```sh
python tools/scan_public.py
node web/tests/public-clock.test.js
cd sports-hub
PYTHONPATH=app python -m unittest discover -s tests -v
```

The shipped scripts are editable source, not minified bundles. No private build inputs are needed to edit or run them. File hashes are in `SHA256SUMS`.
