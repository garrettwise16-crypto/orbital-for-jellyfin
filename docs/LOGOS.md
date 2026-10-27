# Team logos

Orbital displays team artwork supplied by your connected sports source automatically. Choose a source in Setup, save it, then reopen Sports. You do not need to generate a separate logo file when the source includes team badges. If an image is absent, the interface uses team initials.

Artwork retains its original licence and attribution requirements. Open-source distribution does not grant rights to third-party images, and loading an image remotely does not remove those requirements. For TheSportsDB, check its [image licensing terms](https://api.thesportsdb.com/docs_terms_of_use.php). The repository does not bundle a third-party team-logo collection.

## Optional legacy logo map

The following developer commands create a map of ESPN image URLs. They are optional, require reviewing that source's terms, and are not needed for badges already supplied by a connected source.

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

An administrator-connected feed can supply a team's `logo` URL. The web interface accepts HTTPS artwork or an image served from the same Jellyfin origin. Embedded credentials, script/data URLs and URL fragments are rejected. The feed's own logo takes precedence over an optional legacy map. Serve only artwork you have permission to use and retain the required credits. External image hosts receive ordinary browser requests from viewers.
