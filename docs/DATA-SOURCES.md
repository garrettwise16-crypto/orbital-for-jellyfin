# Data sources and accounts

Orbital uses your Jellyfin library and the sources you connect. The basic interface needs no external API key. Additional data sources may require your own account, key, or acceptance of their terms. Setup checks and connects supported sources for you.

| Information | Where it comes from | What you do |
|---|---|---|
| Your movies, shows and channels | Your own Jellyfin server | Nothing new |
| Sports schedules, scores and play-by-play | Your TV guide and connected sports sources | Choose sources in Setup; external providers are opt-in |
| Team logos and artwork | Connected sources, subject to their licences | Use permitted artwork and retain required attribution; see [LOGOS.md](LOGOS.md) |
| TV channels and the TV guide | Your playlist, IPTV provider or antenna tuner | Use Setup → Connect live TV (below) |
| Which of your channels has a game | sports-hub compares the game's networks with your channel names | Add aliases if your channels use call signs (below) |

## ESPN's public data

The optional ESPN public-data connector is off by default. It accesses website data rather than an officially supported developer API. Enabling it does not grant a licence to redistribute ESPN content; review the source terms before using it. You can instead connect TheSportsDB, your own feed, or a provider add-on.

- **It's unofficial.** ESPN doesn't document or support it, and can change or remove it without notice. If that happens, sports screens show the last good copy, marked as out of date, until sports-hub is updated.
- **Be considerate.** sports-hub caches every reply and only refreshes live games while someone is using Sports. Don't lower those limits.
- This project isn't affiliated with or endorsed by ESPN. Schedules and scores are facts; logos and pictures stay on ESPN's servers and are never copied into this repository.

## TV channels and guide

Orbital never provides channels or video. On the Setup results page, open **Connect live TV → Add a live TV source**. This works with or without the Sports feature installed:

1. Choose **Playlist (M3U)**, **IPTV login (Xtream-compatible)**, or **HDHomeRun**.
2. Paste the playlist or tuner address, or enter the provider server address, username and password. Enter your subscription's simultaneous-stream limit. Add an XMLTV guide link if supplied; IPTV login mode derives the standard guide address automatically.
3. Choose **Test connection**. Setup reads the channel list and guide without opening a video, then reports the result.
4. Choose **Save and import channels**. Setup shows its progress as it adds the source and guide to Jellyfin. Existing sources are preserved; an identical source is reused.
5. Wait for **Saved in Jellyfin**, then use **Open Jellyfin** at the bottom. Guide refresh can take a few minutes. Web, Orbital Phone and Orbital TV use the same saved channels and Jellyfin permissions.

Credentials are sent to the provider for validation and saved in your Jellyfin configuration. They are cleared from the setup form after saving and never committed to GitHub. Prefer a provider's HTTPS address when available. Connection limits should match your subscription.

For Schedules Direct, local XMLTV files, other tuner types, or manual channel mapping, use **Jellyfin Dashboard → Live TV**. A Netflix, Hulu, Apple TV or similar app login is not a compatible playlist or tuner connection. Connecting a service catalogue does not grant playback access.

The guide supplies programme names and schedules for Live TV. Sports can also use the external data sources you connect.

## Matching games to your channels

When a connected source supplies a game's broadcast networks, such as `ESPN`, `FOX` or `NBC`, sports-hub compares those names with your Jellyfin channel names and offers a **Watch** button when one matches.

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
