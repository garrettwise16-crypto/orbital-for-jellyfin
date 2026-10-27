# sports-hub

A small service that gives Jellyfin a sports layer: today's games across the major US leagues, live scores and game centers, play trackers, pregame previews and per-account favorite teams. It pairs each game with the Live TV channels the viewer can already watch in Jellyfin, such as an antenna tuner or any other lineup you legally have.

- **Leagues:** NFL, college football (FBS), MLB, NBA, WNBA, NHL, MLS and UFC.
- **Standard library only:** one Python process, no dependencies, 256 MB.
- **Signed-in viewers only:** every request must carry the viewer's Jellyfin token. Channel lists come from Jellyfin with that viewer's own permissions, so nobody sees channels they can't already watch.
- **No video:** sports-hub never opens, proxies or re-streams video. "Watch" means "tune this Jellyfin channel".
- **Spoiler-aware:** each game lists the channels carrying it (`carriers`). A client showing that channel can keep the live tracker hidden, so the tracker never reveals a score before the picture does.

> Schedules, scores and play-by-play come from ESPN's public site API. It is **unofficial and undocumented** and can change or disappear without notice. This project is not affiliated with ESPN. Team logos are linked from ESPN's CDN, not redistributed.

## Run it

```bash
cp .env.example .env        # set JELLYFIN_URL
docker compose up -d --build
```

Put it behind the reverse proxy that serves Jellyfin, so clients call `/sports/api/...` on the same origin. Caddy example:

```
handle /sports/api/* {
    reverse_proxy sports-hub:8080
}
```

## API

All endpoints require the viewer's Jellyfin token, sent as `Authorization: MediaBrowser Token="<token>"` (what Jellyfin's own web client sends) or as `X-Emby-Token: <token>`. sports-hub forwards it to Jellyfin in the `Authorization` form, which Jellyfin 12 requires.

| Endpoint | What it returns |
|---|---|
| `GET /sports/api/events?date=YYYY-MM-DD` | Games for that day (yesterday through six days ahead). Each game has teams, scores, status, AP rank, broadcast networks, `sources` (the viewer's matching channels), `carriers` and `feed_status` (`available` / `none` / `ended`). |
| `GET /sports/api/game/{id}/state?league=NFL` | Game center: clock, period, line score, team stats and situation graphics (bases/count/outs, down & distance, possession). For finished games, a scoring summary and decisions. |
| `GET /sports/api/tracker?league=MLB&event={id}` | Play tracker: pitch locations and at-bat history, football drive chart, basketball shot chart, hockey shots. |
| `GET /sports/api/preview?league=NFL&event={id}` | Pregame: recent form, leaders and team news. |
| `GET /sports/api/rankings` | College football AP / Coaches (and CFP) polls. |
| `GET /sports/api/team-directory?league=NFL`, `GET /sports/api/team?key=NFL~3` | Team pickers and a team's schedule and results. |
| `GET` / `POST /sports/api/team-preferences` | The signed-in account's followed teams (stored in SQLite). |

Every upstream response is cached and bounded. If ESPN fails, the last good copy is served, flagged `stale`.

## Matching games to channels

ESPN's broadcast networks (for example "ESPN" or "FOX") are compared with your Jellyfin channel names after normalization. Channel numbers, "HD", "East/West" and similar suffixes are ignored. The match is exact, so "ESPN" never matches "ESPNU". Antenna channels named by call sign need an alias:

```
CHANNEL_ALIASES=WFLD=FOX;WBBM=CBS;WMAQ=NBC;WLS=ABC
```

## Tests

```bash
PYTHONPATH=app python -m unittest discover -s tests -v
```
