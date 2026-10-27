# Installing Orbital

Orbital is made of separate pieces. Install one, some, or all of them; each works without the others.

| You want | Install | Time |
|---|---|---|
| A streaming-service look for Jellyfin in the browser | [Web interface](#web-interface) | ~5 min |
| Scores, game centers, trackers and "which of my channels has this game" | [sports-hub](#sports-hub) + [web interface](#web-interface) | ~15 min |
| Only the sports data, for your own client or dashboard | [sports-hub](#sports-hub) by itself | ~10 min |
| Team logos in the sports screens | [Team logos](LOGOS.md), after the web interface | ~2 min |

You need Python 3.9+ on the machine you install from, and Docker for sports-hub. The web interface is tested on Jellyfin 12.0, 12.2 and 12.4; other versions are untested.

**Try it on a test server first.** Everything here can be removed, but playback compatibility depends on your Jellyfin version.

---

## Web interface

The web interface is a set of JavaScript and CSS files that load alongside Jellyfin's own web client. It doesn't replace Jellyfin, change your libraries, or touch accounts or watch history.

### 1. Find Jellyfin's web folder

This is the folder that contains Jellyfin's `index.html`.

| How Jellyfin is installed | Web folder |
|---|---|
| Debian / Ubuntu package | `/usr/share/jellyfin/web` |
| Windows installer | `C:\Program Files\Jellyfin\Server\jellyfin-web` |
| Docker (`jellyfin/jellyfin`) | `/jellyfin/jellyfin-web` inside the container; see [Docker](#docker-jellyfin) below |

### 2. Run the installer

```bash
git clone https://github.com/garrettwise16-crypto/orbital-for-jellyfin.git
cd orbital-for-jellyfin
sudo python3 tools/install_web.py --web-dir /usr/share/jellyfin/web
```

On Windows, open PowerShell as Administrator and use `python tools\install_web.py --web-dir "C:\Program Files\Jellyfin\Server\jellyfin-web"`.

The installer:

- saves a one-time copy of `index.html` as `index.html.orbital-backup`;
- copies the files from `web/dist` into a new `orbital/` folder next to it;
- adds one clearly marked block (`<!-- orbital:begin -->` … `<!-- orbital:end -->`) to `index.html`.

It refuses to overwrite an `orbital/` folder it didn't create. Running it again updates the files in place.

### 3. Reload Jellyfin in your browser

You don't need to restart Jellyfin. Open it in the browser and reload the page.

- **See stock Jellyfin for one page load:** add `?orbital=off` before the `#` in the address, for example `https://jellyfin.example/web/?orbital=off#/home`.
- **Remove Orbital:** run the installer again with `--uninstall`. It removes the marked block and only the files it recorded.
- **After a Jellyfin upgrade:** upgrades replace `index.html`, so run the installer again.

### Docker Jellyfin

The web folder lives inside the container image, so changes there are lost when the container is recreated. Instead, keep a copy outside the container, install into the copy, and mount it:

```bash
docker cp jellyfin:/jellyfin/jellyfin-web ./jellyfin-web
python3 tools/install_web.py --web-dir ./jellyfin-web
```

Then add the mount to the Jellyfin service in your `compose.yml` and recreate the container:

```yaml
    volumes:
      - ./jellyfin-web:/jellyfin/jellyfin-web:ro
```

After a Jellyfin image upgrade, delete `./jellyfin-web` and repeat both steps. The new image's web client must be copied fresh, because an old copy doesn't match the new server.

---

## sports-hub

sports-hub is a small service that reads public sports schedules and scores and matches each game to the Live TV channels the viewer can already watch in Jellyfin. It never opens or relays video.

### 1. Configure

```bash
cd sports-hub
cp .env.example .env
```

Edit `.env`:

| Setting | Meaning |
|---|---|
| `JELLYFIN_URL` | How sports-hub reaches Jellyfin, for example `http://jellyfin:8096` on the same Docker network or `http://host.docker.internal:8096`. |
| `CHANNEL_ALIASES` | Only if your channels are named by call sign: `WFLD=FOX;WBBM=CBS`. See [Data sources](DATA-SOURCES.md#matching-games-to-your-channels). |

If Jellyfin runs in Docker, put sports-hub on the same network: add `networks: [default, jellyfin_default]` to the service and declare that network as `external: true` (use your Jellyfin project's network name).

### 2. Start

```bash
docker compose up -d --build
```

It listens on `127.0.0.1:8080` only.

### 3. Put it behind the same address as Jellyfin

Browsers call `/sports/api/...` on the same origin as Jellyfin, so add one route to the reverse proxy that already serves Jellyfin.

**Caddy**

```
jellyfin.example.com {
    handle /sports/api/* {
        reverse_proxy 127.0.0.1:8080
    }
    reverse_proxy 127.0.0.1:8096
}
```

**nginx** (inside your Jellyfin `server { }` block)

```nginx
location /sports/api/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Keep the path as it is: sports-hub expects the full `/sports/api/...` path.

**No reverse proxy?** The web interface needs `/sports/api/` on the same address as Jellyfin, so Sports stays hidden without one. You can still call sports-hub directly from your own client at `http://<host>:8080/sports/api/...` after changing the port binding in `compose.yml`.

### 4. Check it

Open `https://<your Jellyfin address>/sports/api/status` in a browser tab.

- `{"error": "Sign in to Jellyfin to browse sports"}` means the route works. The tab doesn't send your Jellyfin sign-in, so this reply is expected.
- A Jellyfin page or a `404` means the proxy route is missing. A `502` means the proxy can't reach sports-hub.
- If Sports later says it is unavailable for signed-in viewers, sports-hub can't reach Jellyfin: check `JELLYFIN_URL` and `docker compose logs sports-hub`.

With the web interface installed and the Sports service reachable, reload Jellyfin: **Sports** appears in the menu even without Live TV channels. Connect sports data through Setup; external sources are off until you select them. To add channels, use **Connect live TV** on Setup's results page: test your playlist, IPTV login or HDHomeRun, then save and import. See [supported connections](DATA-SOURCES.md#tv-channels-and-guide).

### Using sports-hub without the web interface

Every endpoint takes the viewer's Jellyfin token; the endpoints are listed in [sports-hub/README.md](../sports-hub/README.md#api). For example:

```bash
curl -H "Authorization: MediaBrowser Token=\"$TOKEN\"" "https://jellyfin.example.com/sports/api/events?date=2026-10-27"
```

---

## Removing everything

```bash
python3 tools/install_web.py --web-dir <web folder> --uninstall
cd sports-hub && docker compose down        # add -v to also delete saved favorite teams
```

Then remove the `/sports/api/` route from your proxy.
