# Dashboard Explorer Implementation Plan (user-dashboard)

## Status

Implemented (Dec 2025). This document now includes the as-built Explorer + tiles service details for the
user-dashboard, plus a legacy fry-explorer teardown retained below for reference.

## As-built overview (what shipped in this repo)

- Route: `/explorer` (pages router) with MapLibre globe, privacy-safe hex rendering, and map-first layout.
<!-- Updated: multi-resolution global tiles + telemetry-backed statuses. -->
<!-- Updated: added intermediate resolutions to stabilize hex sizes while zooming. -->
- Global coverage: hex-only vector tiles from the tiles service (layers `hex_grid_r2`, `hex_grid_r3`,
  `hex_grid_r4`, `hex_grid_r5`, `hex_grid_r6`, `hex_grid_r7`, `hex_grid_r8`, `hex_grid_r9`) with zoom-driven splits and count labels; no pins or exact locations.
- Wallet overlays: wallet-owned hexes are rendered locally from `/api/map/my-hexes` so lat/lng never leave the server.
- Panels: stats, legend, and selected-hex panels are collapsible; collapsed icons dock top-right on all screen sizes.
- Device list: "Your devices" list allows quick jump to a hex without exposing locations.
- Status colors: registered (green), unregistered (gray), offline (red, driven by PoC telemetry when available).
- API security: wallet-verified endpoints with rate limits and request locks.
- Indexes: runtime index creation for device/creds lookups to keep map queries responsive.
- Tiles service: separate tilesServer repo (sibling to this repo) builds MBTiles from `creds` data and serves via tileserver-gl.

## UI behavior targets (map visibility)

- Global hex coverage must remain visible across zoom levels (dynamic styling/opacity/labels as zoom changes),
  rather than only appearing when zoomed far in.
- Global coverage should always be hex-only for all devices worldwide (no pins, points, or exact coordinates).

## Core files (dashboard)

- Page & layout: `pages/explorer.tsx`
- Map + layers: `components/explorer/ExplorerMap.tsx`, `components/explorer/mapLayers.ts`
- Panels: `components/explorer/ExplorerStats.tsx`, `components/explorer/ExplorerLegend.tsx`,
  `components/explorer/ExplorerPanel.tsx`
- APIs: `pages/api/map/my-hexes.ts`, `pages/api/map/hex-details.ts`, `pages/api/map/my-devices.ts`,
  `pages/api/map/stats.ts`
- Index helpers: `lib/db/mapIndexes.ts`
- Rate limiting + locks: `lib/api/operationRateLimit.ts`, `lib/db/requestLocks.ts`
- Docker compose integration for tiles service: `docker-compose.yml`, `docker-compose-dev.yml`

## Data flow (privacy-safe)

1) Global hex tiles
   - Source: tiles server (tileserver-gl) serving `/data/hex_grid/{z}/{x}/{y}.pbf`.
   <!-- Updated: include intermediate resolutions in the default layer set. -->
   - Layer names: `hex_grid_r2`, `hex_grid_r3`, `hex_grid_r4`, `hex_grid_r5`, `hex_grid_r6`, `hex_grid_r7`, `hex_grid_r8`, `hex_grid_r9`.
   <!-- Updated: point-only label layers to prevent duplicate labels. -->
   - Label layers: `hex_grid_r2_labels` ... `hex_grid_r9_labels` (one per resolution).
   <!-- Updated: telemetry counts for online/offline outlines. -->
   - Fields: `id`, `count`, `count_label`, `type_counts`, `online_count`, `offline_count`, `unknown_count`, `resolution`.
   - Client source: `components/explorer/ExplorerMap.tsx` (`Source id="global-hexes"`).
   - Client click: uses tile feature `id`/`hexId` when present; falls back to H3 from click coords at
     `NEXT_PUBLIC_EXPLORER_GLOBAL_HEX_RESOLUTION` or the active zoom band.

2) Wallet hexes
   - API: `/api/map/my-hexes` combines `main.devices` (status, miner_key) with `creds.*` positions (`position.hexId`)
     scoped by wallet `address`.
   - Rendering: local GeoJSON fill/outline/labels via `components/explorer/mapLayers.ts`.

3) Selected-hex details
   - API: `/api/map/hex-details` validates H3, filters wallet-owned devices in that hex, returns minimal fields.
   - UI: `ExplorerPanel` lists devices and status, with "Hide" and "Close" behavior.

4) Wallet device list
   - API: `/api/map/my-devices` returns wallet devices with their hex ids (if available) for quick jumps.
   - UI: "Your devices" list uses `onDeviceSelect` to focus the map.

5) Global stats
   - API: `/api/map/stats` counts registered devices and prefix buckets (AEM/BM/NODES/OTHER).
   - Online/offline: populated from `PoC.hardware.uptime.status` once any telemetry exists.

## Data sources (MongoDB)

- `main.devices` (or `main.test-devices` when `NEXT_PUBLIC_TEST_MODE=true`)
  - Used for registration status and miner key prefixes; does not store authoritative location.
- `creds.*` collections (air, camera, energy, weather, water, radiation, hardware, other)
  - Each document contains `address`, `miner_key`, and `position.hexId` used for map placement.
  - Lat/lng remain server-only; only hex ids are surfaced to clients.
- `PoC.hardware`
  - Per-device telemetry doc keyed by `miner_key` with `uptime.status` and `lastUpdated`.
  - Used to set offline status in explorer APIs and online/offline totals in `/api/map/stats`.

## PoC.hardware field reference
<!-- Added: document PoC.hardware fields for telemetry integrations. -->

- `_id`: MongoDB ObjectId for the telemetry document.
- `miner_key`: full miner key string (includes prefix like BM/AEM/RDN/SVN/SDN).
- `miner_type`: short prefix derived from the miner key (ex: `BM`).
- `day`: `YYYY-MM-DD` date string for the daily aggregation window.
- `lastUpdated`: ISO timestamp string for the most recent telemetry ingest ("latest").
- `uptime`: uptime status object.
  - `uptime.status`: string status (ex: `online`); explorer treats anything other than `online` as offline.
- `mac`: MAC validation block.
  - `mac.status`: boolean match status.
  - `mac.last_changed_at`: ISO timestamp when the MAC status changed.
  - `mac.last_checked_at`: ISO timestamp when the MAC was last validated.
  - `mac.evidence`: evidence payload for MAC matching.
    - `miner_mac`: device-reported MAC address.
    - `registered_mac`: MAC address stored at registration.
- `pol`: proof-of-location block.
  - `pol.status`: boolean match status.
  - `pol.last_changed_at`: ISO timestamp when the POL status changed.
  - `pol.last_checked_at`: ISO timestamp when the POL check was last run.
  - `pol.evidence`: evidence payload for POL checks.
    - `ip`: device IP (masked in the sample).
    - `hexID_registered`: registered hex ID for the device.
    - `ipCountry`: country derived from IP.
    - `hexCountry`: country derived from the registered hex.
    - `country_match`: boolean result of country match.
- `rewards`: nested reward ledger keyed by day string.
  - `<day>`: date string bucket (ex: `2025-12-26`).
    - `<bucket>`: string time bucket (ex: `8`, `9`, `10`) for the PoC reward windows.
      - `slots`: array of slot entries (nullable when no data). Each slot represents 1 hour. <!-- Added: slot duration clarification. -->
        - `gates`: per-slot eligibility flags.
          - `data`: data present for the slot.
          - `online`: online status during the slot.
          - `mac_match`: MAC check result for the slot.
          - `pol`: proof-of-location check result (boolean).
          - `poi`: proof-of-installation check result (required for AEM devices; null/false elsewhere). <!-- Added: AEM-only POI requirement. -->
        - `tools_active`: list of tools active in the slot (BM devices only: `bright`, `honeygain`, `mysterium`). <!-- Added: BM-only tools context. -->
        - `tools_count`: count of active tools (BM devices only).
        - `multiplier`: reward multiplier applied to the slot.

## Indexes (added/ensured at runtime)

- `main.devices` / `main.test-devices`
  - `explorer_address_miner_key` on `{ address: 1, miner_key: 1 }`
- `creds.*`
  - `explorer_address_miner_key` on `{ address: 1, miner_key: 1 }`
  - `explorer_address_hex` on `{ address: 1, position.hexId: 1 }`
- `PoC.hardware`
  - `telemetry_miner_key` on `{ miner_key: 1 }`

## Tiles service (tilesServer, sibling repo)

- Build container: `fry-dashboard-tiles-builder`
  - Reads `MONGO_TILES_URI` via 1Password (`OP_TILES_SERVICE_ACCOUNT_TOKEN`).
  - Scans `creds` collections, aggregates by hex per resolution, applies k-anon (<=6: `k=3`, >=8: `k=1`),
    and emits `hex_grid.mbtiles` with multiple layers.
  <!-- Updated: online/offline telemetry counts sourced from PoC.hardware. -->
  - Telemetry join: PoC `hardware` is read by `miner_key` to populate `online_count`/`offline_count`.
  - Writes MBTiles into a shared Docker volume (`tileserver-data`).
- Serve container: `fry-dashboard-tiles` (maptiler/tileserver-gl)
  - Serves tiles on port `3018` with `config.json` mounted from the tilesServer repo.
  - TileJSON: `/data/hex_grid.json`, vector tiles: `/data/hex_grid/{z}/{x}/{y}.pbf`.
- Dashboard consumes the service via `NEXT_PUBLIC_TILES_URL`.

## Environment variables (dashboard)

- `NEXT_PUBLIC_TILES_URL` — base URL for the tileserver-gl instance.
- `NEXT_PUBLIC_EXPLORER_STYLE_LIGHT` — optional MapLibre style URL for light mode.
- `NEXT_PUBLIC_EXPLORER_STYLE_DARK` — optional MapLibre style URL for dark mode.
- `NEXT_PUBLIC_EXPLORER_GLOBAL_HEX_RESOLUTION` — fallback H3 resolution for click-derived hexes.
- `MONGO_CREDS_DB` — optional override for the credentials DB name (defaults to `creds`).

## Environment variables (tiles service)

- `MONGO_TILES_URI` — MongoDB URI with read access to `creds` (tiles build).
- `OP_TILES_SERVICE_ACCOUNT_TOKEN` — 1Password service account token for `TilesServer` vault.
<!-- Updated: include intermediate resolutions in default list. -->
- `TILESERVER_HEX_RESOLUTIONS` — comma-separated H3 resolutions for global layers (default: `2,3,4,5,6,7,8,9`).
- `TILESERVER_K_ANON` — minimum device count for low-resolution layers (default: `3`).
- `TILESERVER_MAX_ZOOM` — max zoom for tippecanoe tiles (default: `12`).
<!-- Updated: telemetry DB overrides for tiles builder. -->
- `MONGO_POC_DB` — optional PoC telemetry DB override (default: `PoC`).
- `MONGO_POC_COLLECTION` — optional PoC telemetry collection override (default: `hardware`).

## Open TODOs

<!-- Updated: prior telemetry tasks completed. -->
- No open items at this time; revisit when hardware telemetry adds new status fields.
