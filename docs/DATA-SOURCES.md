# Data sources and accounts

Orbital doesn't come with any data, accounts or keys. The free version needs **no API keys at all**. This page lists where each kind of information comes from, and what you set up yourself.

| Information | Where it comes from | What you do |
|---|---|---|
| Your movies, shows and channels | Your own Jellyfin server | Nothing new |
| Sports schedules, scores, play-by-play, standings, polls, team news | ESPN's public website data, read by sports-hub | Nothing; optionally set `SPORTS_USER_AGENT` |
| Team logos | ESPN's image servers, linked from each viewer's browser | Run two commands: see [LOGOS.md](LOGOS.md) |
| TV channels and the TV guide | Your Jellyfin Live TV setup | Set up Live TV in Jellyfin (below) |
| Which of your channels has a game | sports-hub compares the game's networks with your channel names | Add aliases if your channels use call signs (below) |

## ESPN's public data

sports-hub reads the same public data that ESPN's own website uses. You don't need a key, an account or an agreement.

- **It's unofficial.** ESPN doesn't document or support it, and can change or remove it without notice. If that happens, sports screens show the last good copy, marked as out of date, until sports-hub is updated.
- **Be considerate.** sports-hub caches every reply and only refreshes live games while someone is using Sports. Don't lower those limits.
- **Identify yourself if you like:** set `SPORTS_USER_AGENT` in `sports-hub/.env`, for example `my-orbital-server (you@example.com)`.
- This project isn't affiliated with or endorsed by ESPN. Schedules and scores are facts; logos and pictures stay on ESPN's servers and are never copied into this repository.

## TV channels and guide

Orbital never provides channels or video. It shows the Live TV channels your Jellyfin server already has, using each viewer's own Jellyfin permissions. Set up Live TV in Jellyfin first (**Dashboard → Live TV**):

1. **Add a tuner**, such as an antenna with an HDHomeRun, or one of the other tuner types Jellyfin supports for services you subscribe to.
2. **Add a guide (program listings)**. Jellyfin supports:
   - **Schedules Direct**: a paid listings service (about US$35 a year) with a free trial. Create your own account at schedulesdirect.org, then enter it in Jellyfin's guide settings. The account and its password stay in Jellyfin; Orbital never sees them.
   - **XMLTV**: a guide file or address. Many tuners and services provide one.
3. Map each channel to its guide entry in Jellyfin.

The guide matters for the Live TV and Guide screens. Sports works without it, because game times come from ESPN.

## Matching games to your channels

For each game, ESPN lists the networks carrying it, such as `ESPN`, `FOX` or `NBC`. sports-hub compares those names with your Jellyfin channel names and offers a **Watch** button when one matches.

- Channel numbers, `HD`, `East`/`West` and similar extras are ignored, so `206 ESPN HD` matches `ESPN`.
- The match is exact: `ESPN` never matches `ESPNU`.
- **Antenna channels are usually named by call sign**, such as `WFLD` instead of `FOX`. Tell sports-hub which network each one carries in `sports-hub/.env`:

  ```
  CHANNEL_ALIASES=WFLD=FOX;WBBM=CBS;WMAQ=NBC;WLS=ABC
  ```

  Use your local stations' call signs, then restart sports-hub with `docker compose up -d`.
- Games on streaming-only services, such as Peacock or ESPN+, have no matching channel unless your Jellyfin lineup includes one. They still appear with scores and trackers.

## Keeping secrets out of the repository

- `sports-hub/.env` is yours. Never commit it.
- sports-hub stores no Jellyfin passwords or keys. Each request uses the signed-in viewer's own Jellyfin token, which is forwarded to your Jellyfin server and never saved.
- Favorite teams are stored per account in a small SQLite file in the `sports-preferences` Docker volume.
