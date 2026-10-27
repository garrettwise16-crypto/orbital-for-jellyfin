# Team logos

Team logos are trademarks of the leagues and teams, so this repository doesn't include any. Without them, Orbital shows team initials. Adding them takes two commands.

```bash
python3 tools/make_team_art.py
python3 tools/install_web.py --web-dir <jellyfin web folder> --team-art team-art.js
```

Reload Jellyfin in the browser.

## What the commands do

The first command reads ESPN's public team lists and writes one small file, `team-art.js`. It covers the NFL, college football, MLB, NBA, WNBA, NHL and MLS, about 930 teams. For each team the file holds:

- the address of its logo on ESPN's image servers;
- its short name, such as `CHI`;
- its team color, used in game headers and trackers.

The second command installs that file next to the web interface.

**No images are downloaded or stored on your server.** Each viewer's browser loads the logos from ESPN's image servers, the same way ESPN's own site does. ESPN can change or remove these images at any time. If logos stop appearing, run both commands again.

## Options

| Command | Effect |
|---|---|
| `make_team_art.py --dark` | Logos drawn for dark backgrounds (they suit Orbital's dark screens). |
| `make_team_art.py --leagues NFL,MLB` | Only some leagues. Names: `NFL`, `College football`, `MLB`, `NBA`, `WNBA`, `NHL`, `MLS`. |
| `install_web.py ... --no-team-art` | Remove the logos and go back to team initials. |

Running `install_web.py` again without `--team-art`, for example after a Jellyfin upgrade, keeps the logos you already installed.

## Your own images

For now, the web interface only displays logo images from ESPN's image servers. This is a deliberate safety check: pages never load images from arbitrary addresses. Support for a folder of your own images, served from your own server, is planned.
