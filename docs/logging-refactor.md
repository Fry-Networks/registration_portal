# Logging Refactor Rollout Plan

This document tracks the remaining API routes that still need to adopt the enhanced logging + sanitized error response pattern. The goal is to ensure every endpoint:

1. Logs operational errors via `loggers.apiError` (or another `loggers.*` helper) with useful metadata.
2. Uses `handleApiError` / `createApiError` from `lib/api-errors.ts` for consistent responses.
3. Removes `console.error` / raw error strings from responses.
4. Never returns sensitive details (stack traces, node responses, mnemonics, etc.) to clients.
5. Includes success-side context logs where valuable (e.g., `loggers.stakeOperation`).
6. Writes structured JSON files under `~/user-dashboard/logs` (mounted to `/app/logs`) via the shared logger’s daily rotation.
7. Populates error metadata with `miner_key`, wallet `address`, `issueType`, and `part` so Discord alerts include actionable context.
8. Relies on `DISCORD_BUG_WEBHOOK_URL` (shared with the bug report flow) for outbound alerts, so no extra webhook configuration is needed.

## Shared logging helpers

- Server/API routes should continue to use `loggers.apiError` (or `handleApiError`) so that Discord alerts include full context automatically.
- Background scripts can call `loggers.scriptError('<script-name>', error, metadata)` to emit the same structured payload (metadata keys match API expectations).
- Client-side code can dispatch toast/runtime issues through `emitClientError({ message, issueType, part, ... })`; the hook in `_app` already wires toast errors and `console.error` output into `/api/logging/client-error`.

## Completed Work

- ✅ All APIs (staking, registrations, rewards, conversions, credential CRUD, weather/energy, BYOD) now emit errors via `loggers.apiError` + `handleApiError` with sanitized responses. `rg "logger\." pages/api` returns nothing.
- ✅ `/api/logging/client-error` hardened to validate payloads, reject malformed requests, and forward issues to Discord with full context.
- ✅ Discord webhook notifications use token-bucket rate limiting (minute + hour buckets), include drop counters, and expose helpers for tests (`__set/__resetDiscordWebhookUrlForTests`).
- ✅ Fast-feedback Node tests (`tests/discord-webhook.test.js`, `tests/api-errors.test.js`) run through `npm test`, covering rate limiter behaviour and representative `handleApiError` logging.
- ✅ `docs/logging-refactor.md` updated with the finished/in-progress matrix below.

## Immediate Follow-Ups

- [ ] Audit every `handleApiError` call to ensure `minerKey`, `walletAddress`, `issueType`, and `part` are passed explicitly (not hidden inside `metadata`).
- [ ] Standardize wallet mismatch responses on `CommonErrors.walletMismatch()` where bespoke JSON is still returned.
- [ ] Verify success-path instrumentation: make sure staking/reward/conversion/hardware + credential updates emit `loggers.stakeOperation`, `loggers.txnLog`, or other info-level events where useful.
- [ ] Monitor Discord webhook responses for 429/5xx and log/escalate when the webhook throttles.

## Outstanding coverage tasks

### API / server handlers

- [x] Replace remaining `res.status(...).json({ message })` / raw `logger.*` usage with `handleApiError` + sanitized responses. (Completed.)
- [ ] Spot-audit `handleApiError` invocations to confirm `issueType`/`part` context is meaningful and consistent (create a quick checklist of any endpoints needing richer metadata).
- [ ] Verify success-path logging: review staking, rewards, conversions, hardware CRUD to ensure `loggers.stakeOperation`, `loggers.txnLog`, or other helpers capture positive outcomes where useful.
- [ ] Run `rg 'console\.(error|log)' pages/api` and migrate any stragglers (scripts under `/scripts` still pending separate pass).
- [ ] Examine shared auth middleware (`lib/auth.ts`, NextAuth callbacks) for parity with the logging pattern (most rejection paths now call `CommonErrors.noSession`; confirm they also log through `loggers.apiError` where appropriate).

### Client UI (React / browser)

- [ ] Replace any `console.error` in components with user-friendly toast + `emitClientError` metadata: key files include `components/Navbar.tsx`, `components/DeviceListItem.tsx`, `components/modals/*.tsx`, `pages/devices.tsx`, `pages/register.tsx`, `pages/history.tsx`, `pages/signin.tsx`, and wallet-related hooks.
- [ ] Ensure toast-triggered errors pass miner key + wallet address when known so the client logger submits complete context.
- [ ] Verify error boundaries (if any) and Suspense fallbacks raise `emitClientError` events on failure.
- [ ] Add instrumentation for third-party SDK failures (wallet connectors, map widgets, Tinyman swaps) so catches call `emitClientError` rather than silent console output.
- [ ] Confirm the client logger captures copy-to-clipboard, clipboard permission, and other browser API failures (see `components/CopyAddress.tsx`, modals with geolocation, etc.).

### Scripts / CLI utilities

- [ ] Update scripts under `/scripts` (e.g., `cleanup-legacy-credentials.ts`, `sync-portal-models.ts`, `update-user-info.ts`, `migrate-hardware-credentials.ts`, `restore-air-hardware.ts`, `manage-exceptions.ts`) to replace `console.error` with `loggers.scriptError` and include miner key / address when available.
- [ ] For Node scripts that currently `console.error('Error: MONGO_URI...')`, switch to `loggers.scriptError` so configuration issues trigger Discord alerts.
- [ ] Ensure cron / background jobs that import shared code propagate errors through the logger instead of swallowing them.

### Infrastructure & verification

- [ ] Confirm `DISCORD_BUG_WEBHOOK_URL` (or fallback env names) is set in every deployment environment (app server, scripts, workers) to avoid silent failures.
- [ ] Add automated lint / unit checks to block new `console.error` or direct `logger.error` usage outside the approved helpers.
- [ ] Backfill tests or manual drills to verify end-to-end alerts for representative flows (API failure, toast error, unhandled rejection, script crash).
- [ ] Document runbooks for triaging Discord alerts (error code taxonomy, how to locate logs in `logs/error-*.json`).
- [x] Implement Discord webhook rate limiting: add a retry-safe queue or token bucket (per minute and per hour) inside `notifyDiscordError` so bursty failures do not hit Discord rate caps. Expose counters in logs for observability and add circuit-breaker behavior (e.g., drop low-priority alerts once limits are reached).
- [ ] Monitor webhook responses and escalate when Discord returns 429/5xx by logging to file and emitting a lightweight alert so we know when rate limits trigger.
- [x] Add fast-feedback tests (Node `--test`) covering `notifyDiscordError` rate limiting behaviour and representative API error handling so logging regressions are caught automatically.

### Suggested sequencing for the next task pick-up

1. **Finish metadata & wallet audits** (tick the two immediate follow-up bullets at the top).
2. **Review success-path logging** and add any missing `loggers.*` info events.
3. **Implement webhook response monitoring** (429/5xx handling + optional alerting) and add a small regression test if practical.
4. **Client instrumentation pass**: build the toast/`emitClientError` helper, retrofit priority components, and add a React test.
5. **Script/cron sweep**: replace `console.error` with `loggers.scriptError` in `/scripts`.
6. **Runbook documentation**: write a short guide for Discord alert taxonomy and locating rotated log files.

### Next-up roadmap (when starting a new task)

1. **Server metadata audit**
   - Grep for `handleApiError(` and ensure each call passes `minerKey`, `walletAddress`, `issueType`, and `part`. Document any gaps in this file so they can be patched quickly.
   - Review helper responses that still embed wallet mismatch messages manually; standardize on `CommonErrors.walletMismatch()` unless custom messaging is required.
2. **Success-path instrumentation**
   - Enumerate critical flows (staking, rewards, conversions, hardware, credentials) and confirm each emits at least one `loggers.*` info-level event on success. Add missing instrumentation, especially for credential saves and weather/energy unlink operations.
3. **Webhook monitoring**
   - Extend `notifyDiscordError` to surface 429/5xx responses (e.g., log to file and optionally emit a lightweight console warning) and add a follow-up test covering the behaviour.
4. **Client console → toast instrumentation**
   - Build a shared client helper (e.g., `logClientError`) that triggers toasts plus `emitClientError`.
   - Replace direct `console.error` usage in priority components and hooks. Ensure errors carry `minerKey`/`walletAddress` when available.
   - Add at least one React test verifying the helper raises a toast and posts to the logging endpoint.
5. **Scripts & cron jobs**
   - Sweep `/scripts` for `console.error` and swap to `loggers.scriptError`, adding metadata for miner key / address where available.
6. **Runbooks & docs**
   - Draft a short troubleshooting section covering Discord alert taxonomy, locating rotated log files, and interpreting `issueType`/`part`.

## How to update an endpoint

1. **Imports**
   - Add `import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';`
   - Add `import { loggers } from '../../../lib/logger';`
   - Use `notifyDiscordError` from `lib/discord-webhook` directly only for non-API scripts; API routes should rely on `loggers.apiError` to emit alerts.

2. **Validation failures**
   - Replace ad-hoc `res.status(...).json({ message: ... })` with `createApiError(...)`. Leverage `CommonErrors` helpers when applicable.

3. **Success logging**
   - After key DB updates or chain transactions, add structured info logs via `loggers.*` helpers (e.g., `loggers.stakeOperation('registration_complete', miner_key, {...})`).

4. **Catch blocks**
   - Replace `console.error` with `handleApiError(res, '<endpoint>', error, { response: createApiError(...), metadata: {...} })`.
   - Include identifiers (`miner_key`, `address`, `issueType`, `part`, `txId`, etc.) in `metadata` for debugging and Discord alerts.

5. **Testing**
   - Exercise the endpoint (manually or via existing flows) to confirm the client still receives friendly errors and the server emits structured JSON logs.

## Endpoints still pending

- Rewards
  - `/api/rewards/get-asset-totals` ✅ (converted)
  - `/api/rewards/get-reward-summary` ✅ (converted)
  - `/api/rewards/get-rewards-page` ✅ (converted)
  - `/api/rewards/get-reward-records` ✅ (converted)
  - `/api/rewards/confirm` ✅ (converted)
- Claims
  - `/api/rewards/get-reward-summary` (`useRewardSummary` fetch target) already converted, **verify**; others above need updates.
- Staking
  - `/api/stake/registration` ✅ (converted)
  - `/api/stake/node-staking` ✅ (converted)
  - `/api/stake/verification` ✅ (converted)
  - `/api/stake/verify-node` ✅ (converted)
- Withdrawals
  - `/api/stake/r-withdraw` ✅ (converted)
  - `/api/stake/n-withdraw` ✅ (converted)
  - `/api/stake/stake-withdraw` ✅ (converted)
  - `/api/stake/withdrawable` ✅ (converted)
- Credentials
  - `/api/credentials/validate` ✅ (converted)
  - `/api/credentials/unlink` ✅ (converted)
  - `/api/credentials/get` ✅ (converted)
  - Device credential save endpoints (`/api/devices/save-*.ts`) ✅ (converted)
  - Vendor-specific validators under `/api/credentials/*` (camera RTSP, energy SwitchBot, energy Shelly, hardware MAC) ✅ (converted)
- Conversions
  - `/api/conversion/set_fry_conversion` ✅ (converted)
  - `/api/convert-byod` ✅ (converted)
- Registration / device flows
  - `/api/devices/save-device-info` ✅ (converted)
  - `/api/devices/save-wallet-info` ✅ (converted)
  - `/api/devices/save-map-info` ✅ (converted)
  - `/api/devices/save-credentials` ✅ (converted)
  - `/api/devices/delete` ✅ (converted)
  - `/api/devices/[miner_key]` ✅ (converted)
- Hardware portals / energy/weather endpoints (`/api/energy/shelly-devices`, `/api/energy/switchbot-devices`, `/api/energy/unregister`, `/api/energy/shelly`, `/api/weather/*`) ✅ (converted)
- Fee helpers (`/api/fee/*`) ✅ (converted)
- Any remaining legacy `console.error` / `console.log` in `pages/api/**/*` outside the converted list – **pending audit**

## Suggested rollout order

1. **High-traffic critical flows**: claim + staking + instant boost (already partially done).
2. **Device management**: `/api/devices/*` endpoints, credential validation.
3. **Conversion flows** (FRY/BYOD) – these often interact with external indexers.
4. **Hardware integrations** (energy/weather) – apply pattern and ensure secrets stay server-side.
5. **Fee utilities / miscellaneous endpoints**.

## Verification checklist per endpoint

- [ ] `console.error` removed.
- [ ] Validation responses use `createApiError` / `CommonErrors`.
- [ ] Catch block uses `handleApiError` with metadata.
- [ ] Success logs (if useful) emit via `loggers.*`.
- [ ] Swapped environment secrets or transaction data are not leaked to the client response.

Keep this file updated as endpoints are migrated (check boxes, add new endpoints discovered during the audit). This ensures future tasks can continue right where the previous pass stopped.
