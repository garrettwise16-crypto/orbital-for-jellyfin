# Orbital Phone and TV previews

Download the signed APK for your device from the [native preview release](https://github.com/garrettwise16-crypto/orbital-for-jellyfin/releases/tag/native-v2026.10.27-preview.4). Install it, then enter your Jellyfin server address and sign in. These apps have their own public package identity and update channel.

Use Orbital Setup on the server to add the web interface, Sports and optional integrations. The Phone app uses your server's web interface alongside its native player. TV has its own native interface. Episode and season selection, start from beginning, short seeking, channels, Sports and free estimated trackers are included. Only the services/data you connect are available. Paid picture alignment and feed-trust implementations are excluded.

Every APK is accompanied by its complete corresponding source archive, including build instructions and original license notices. Phone is GPL-2.0; TV is GPL-2.0. The source archive is the source for that exact APK, not an unrelated upstream snapshot. Updates verify the public signer and downloaded file hash.

## Validation limits

Phone79: 548 tests in 50 suites. TV303: 1,523 tests in 193 suites. Both builds used frozen sources and passed full source/APK privacy checks. Public apps were installed alongside household apps against an independent Jellyfin 12.4 server. S24 checks covered native playback, channel selection and the landscape episode drawer; stock Jellyfin playback and Live TV also worked. Shield checks covered installation, Sports navigation and earlier episode/season journeys. These are bounded journeys, not full-game timing or all-screen-size acceptance.

The 5–8-second live-switching target has not been established. Fold layouts and complete live-game tracker acceptance remain separate work. This is a preview, not a claim of completed cross-client acceptance. Paid picture alignment and feed-trust implementations are intentionally excluded.

Phone79 also accepts connected-provider headshots and hides playback controls under the episode/channel drawer. S24 checks covered ten-second seek in both directions, restart, quality/audio menus, season selection and the portrait drawer.

Phone79 requests one completed HLS segment, matching the web profile. Ten consecutive S24 switches between paced local test channels rendered successfully: median 8.96 seconds, maximum 9.76 seconds. This does not measure external providers. Repeat-play recovery after leaving or ending playback remains under investigation.
