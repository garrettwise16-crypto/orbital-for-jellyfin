# Current container deployment

The container now runs the same public service as guided setup: personal library, optional requests, service catalogues with daily refresh, administrator-selected sports sources, and estimated trackers. Existing team preferences keep their volume. New installations begin with your own TV guide; ESPN public data is opt-in.

Run `docker compose up -d --build` from this folder. The build context is the repository root. Keep the published port bound to loopback and route `/sports/api/*` through the same origin as Jellyfin. Every data request still requires a valid Jellyfin user; configuration requires an administrator. There is no shared administrator API key in the container.

After starting, connect the Windows guided setup to that Jellyfin address. It detects the existing standalone backend and lets you configure sources, Seerr and catalogues without installing another service or restarting Jellyfin.

The older `app/` implementation is retained as reference for existing integrations; the Dockerfile deliberately builds `setup/sports_service/app/` so the two supported deployments cannot silently diverge.

## Connect it

Copy `.env.example` to `.env` and set `JELLYFIN_URL` to the address reachable from the container. Start with `docker compose up -d --build`. Your reverse proxy must forward `/sports/api/*` to this service on the same origin as Jellyfin. For example, on a shared Docker network:

```caddy
handle /sports/api/* {
    reverse_proxy sports-hub:8080
}
```

The supplied Compose file publishes only on the host loopback address. A proxy running in another container needs a shared network; a host proxy uses `127.0.0.1:8080`.

## Data and optional features

Use guided setup to select your sports data source, connect your own Seerr server, and import service catalogues. Sources and credentials are not bundled. ESPN public data is an explicit opt-in and is unofficial; availability and fields depend on the source you choose. Your own TV guide works without that opt-in. Logos come from your selected source, not a redistributed logo pack.

Trackers use estimated timing and manual Sync for watched games. Private paid picture synchronization is not included. No video is opened or relayed by this service; Watch opens an authorized channel in Jellyfin.

The `/preferences` volume preserves settings and per-account team preferences across rebuilds. Do not remove it during upgrades. Configuration endpoints require a Jellyfin administrator; normal data endpoints use the signed-in viewer's library and channel permissions.

## Verification

From the repository root:

```sh
python tools/run_setup_tests.py
python tools/scan_public.py
```

These test the shared service used by both the container and the Windows package. The legacy `sports-hub/tests` suite covers the retained old implementation only.
