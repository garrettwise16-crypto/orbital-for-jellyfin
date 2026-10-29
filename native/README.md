# Orbital Phone and TV previews

Download [TV304](https://github.com/garrettwise16-crypto/orbital-for-jellyfin/releases/tag/native-v2026.10.28-preview.1) or [Phone80](https://github.com/garrettwise16-crypto/orbital-for-jellyfin/releases/tag/native-v2026.10.27-preview.5). Install the signed APK, then enter your Jellyfin server address and sign in. These apps have their own public package identity and update channel.

Use Orbital Setup on the server to add the web interface, Sports and optional integrations. The Phone app uses your server's web interface alongside its native player. TV has its own native interface. Episode and season selection, start from beginning, short seeking, channels, Sports and free estimated trackers are included. Only the services/data you connect are available. Paid picture alignment and feed-trust implementations are excluded.

Every APK is accompanied by its complete corresponding source archive, including build instructions and original license notices. Phone is GPL-2.0; TV is GPL-2.0. The source archive is the source for that exact APK, not an unrelated upstream snapshot. Updates verify the public signer and downloaded file hash.

## Validation limits

Phone80: 549 tests in 50 suites. TV304: 1,523 tests in 193 suites. Both builds used frozen sources and passed full source/APK privacy checks. TV304 stacks full pitcher/batter names, places pitch and result captions inside the animation surface below home plate, preserves speed units beside wrapping pitch names, and applies the edge/near-miss close-up rule. A single pitch no longer creates a duplicate history chip.

The same layout was observed in household Shield playback, but this exact public TV304 APK has not yet received physical Shield acceptance. The long fastball label and full-game timing remain open checks. Earlier public TV previews covered installation, Sports navigation and episode/season journeys against an independent Jellyfin 12.4 server. S24 checks covered native playback, channel selection and the landscape episode drawer; stock Jellyfin playback and Live TV also worked. These are bounded journeys, not all-screen-size or complete-game acceptance.

The 5–8-second live-switching target has not been established. Fold layouts and complete live-game tracker acceptance remain separate work. This is a preview, not a claim of completed cross-client acceptance. Paid picture alignment and feed-trust implementations are intentionally excluded.

Phone79 also accepts connected-provider headshots and hides playback controls under the episode/channel drawer. S24 checks covered ten-second seek in both directions, restart, quality/audio menus, season selection and the portrait drawer.

Phone79 requests one completed HLS segment, matching the web profile. Ten consecutive S24 switches between paced local test channels rendered successfully: median 8.96 seconds, maximum 9.76 seconds. This does not measure external providers. Phone80 additionally joins the existing exact-session close acknowledgement before admitting another native play. Normal Back/Play and reopening after a naturally ended test stream were checked on S24; the latter rendered in 7.38 seconds after browsing was ready. An early tap during the closing transition was ignored. This does not establish recovery from every provider failure.
