# AirAPI Decoupling Status & Credential API Guide

## 1. Current State
- AirAPI is no longer referenced by the dashboard codebase. Searches for `AirAPI`, `NEXT_PUBLIC_API_HOST`, legacy submit routes, and `:3000` returned no matches outside of historical docs (`rg -n "AirAPI"`, `rg -n "NEXT_PUBLIC_API_HOST"`, `rg -n "/api/submit"` run at repo root).
- Credential intake, validation, storage, and unlink flows are now served entirely from the Next.js app.
- Environment files no longer require `NEXT_PUBLIC_API_HOST` or similar variables—the UI talks to `/api/credentials/*` on the dashboard host.

## 2. Architecture Overview
```
Client (registration wizard)
    ↓ fetch('/api/credentials/*')
Next.js API Routes (pages/api/credentials/*.ts, pages/api/devices/save-credentials.ts)
    ↓ clientPromise
MongoDB (creds database: air, camera, energy, weather, water, radiation, hardware, other)
```
- Shared DB client: `lib/mongoclient.ts:1`
- Credential utilities for portal/collection mapping: `pages/api/credentials/utils.ts:1`

## 3. Endpoint Reference
- **POST `/api/credentials/get`** (`pages/api/credentials/get.ts:1`)
  - Auth: NextAuth session required
  - Body: `{ miner_key: string }`
  - Finds the first credential document for the logged-in user across `creds` collections; returns 404 when none exist.
- **POST `/api/credentials/validate`** (`pages/api/credentials/validate.ts:1`)
  - Infers API type, enforces uniqueness (e.g., MAC/deviceId), and delegates to validator registry.
  - Legacy delegation currently only used for RTSP (`camera/rtsp`).
- **POST `/api/devices/save-credentials`** (`pages/api/devices/save-credentials.ts:1`)
  - Upserts `{ miner_key, address, credentials, api_type? }` into the appropriate `creds` collection.
  - Persists `credentials_saved_at` timestamps for auditing.
- **POST `/api/credentials/unlink`** (`pages/api/credentials/unlink.ts:1`)
  - Deletes the credential document for the logged-in wallet (optionally scoped via `portal`).
- **Specialized validators**:
  - Camera RTSP: `pages/api/credentials/camera/rtsp.ts:1`
  - Hardware MAC: `pages/api/credentials/hardware/mac.ts:1`
  - Energy devices: `pages/api/credentials/energy/shelly.ts:1`, `pages/api/credentials/energy/switchbot.ts:1`

## 4. Validator Coverage
- Registry lives in `lib/validators/DeviceValidatorRegistry.ts:1`; exported instance `deviceValidatorRegistry`.
- Native validators (remote API call + structured success payload):
  - `awair`, `kaiterra`, `atmotube`, `switchbot`, `shelly`, plus multiple MAC-based subtypes (`mac`, `hardware`, `node`, `aem`, `pebble`).
- Subtypes without a dedicated validator fall back to:
  - Field-level validation in `pages/register.tsx:752-804`
  - Server-side uniqueness checks in `pages/api/credentials/validate.ts:70-118`
- RTSP validation is handled via delegation to the dedicated endpoint due to streaming/timeout requirements.

## 5. Data Model (`creds` Database)
- Collections mirror portal categories (`air`, `camera`, `energy`, `weather`, `water`, `radiation`, `hardware`, `other`).
- Document shape (example):
  ```json
  {
    "miner_key": "HWM-12345",
    "address": "ALGOWALLET",
    "miner_type": "weather",
    "api_type": "ecowitt",
    "credentials": { "app_key": "...", "api_key": "..." },
    "credentials_saved_at": ISODate("2024-09-01T12:00:00Z")
  }
  ```
- Collection selection helper: `collectionFor()` in `pages/api/credentials/utils.ts:31`
- Portal inference: `portalKeyFromMiner()` in `pages/register.tsx:277`

## 6. Client Flow (Registration Wizard)
1. **Prefill existing credentials** – `pages/register.tsx:620-677` calls `/api/credentials/get`.
2. **User edits & validates** – UI triggers registry validation or falls back to `/api/credentials/validate` (`pages/register.tsx:753-827`).
3. **Persist** – `/api/devices/save-credentials` invoked during the “Save & Next” flow (`pages/register.tsx:909-1011`).
4. **Unlink/reset** – `/api/credentials/unlink` used when the user clears credentials (`pages/register.tsx:1012-1050`).

## 7. Support & Operations Notes
- Legacy AirAPI `clearRegistration` handler (bulk deletes by miner key) is not duplicated verbatim. With all credentials consolidated in `creds`, support can:
  - Use `/api/credentials/unlink` for user-scoped resets.
  - Run targeted Mongo queries/scripts when bulk cleanup is required (collections are shallow and namespaced by `miner_key` + `address`).
- Hardware MAC ownership continues to be enforced by `pages/api/credentials/hardware/mac.ts:1` and linked-miner rules in `LINKED_MINER_TYPES` (`pages/api/credentials/utils.ts:5`).

## 8. Verification Checklist
Executed commands (workspace root):
- `rg -n "AirAPI"`
- `rg -n "NEXT_PUBLIC_API_HOST"`
- `rg -n "/api/submit"`
- `rg -n ":3000"`

All returned matches only in historical documentation—no runtime code paths reference the legacy service.

## 9. Maintenance Tips
- Add new validators by subclassing `BaseValidator` and registering in `DeviceValidatorRegistry`.
- When introducing new portal types, update:
  - `PORTAL_SUBTYPES` and `FIELD_LABELS` in `pages/register.tsx:232-344`
  - `MINER_PORTAL_KEY` / `collectionFor` in `pages/api/credentials/utils.ts:9-41`
- Keep validator endpoints stateless; they rely on NextAuth sessions for ownership checks.
