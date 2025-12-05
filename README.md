# user-dashboard — Architecture and Flows

This document explains how the Fry user dashboard works end‑to‑end: authentication, registration, staking, rewards, and data storage. It’s intended to be a standing reference so future contributors don’t need to re‑analyze the whole codebase.


## Overview

- Next.js app (pages router) with NextAuth for wallet login (Algorand).
- Server RTSP validation endpoint: `/api/credentials/camera/rtsp` (canonical for camera credential checks).
- MongoDB for all state: users, devices, products, rewards, etc.
- Algorand network for staking/claims. Wallets via `@txnlab/use-wallet(-react)`.
- DIMO AEM airdrop using the hosted Login with DIMO UserJWT flow to issue miner keys for eligible subscriptions.
- Rewards modeled weekly (with support for historical pre‑cutoff daily entries).
- FRY 1.0 reward buckets are retired; any legacy FRY 1.0 entries are aggregated into the tFry totals, and conversions remain available via the `fry-conversions` flow.
- Device credential intake and validation handled in-app (`/api/credentials/*`, `/api/devices/save-credentials`), replacing the legacy AirAPI dependency.


## Authentication

- Wallet login flow:
  - UI signs a 0‑ALGO payment txn with a note challenge.
  - Backend verifies the signature and the note contents.
  - User record is created/updated in `registration-users`.
  - Session is JWT-based.

Key code:
- Provider: `lib/WalletAuthProvider.ts:1`
- Signature verify: `lib/auth.ts:5`
- NextAuth config: `pages/api/auth/[...nextauth].ts:1`

User fields
- `address`, `email`, `first_name`, `last_name` in `main.registration-users`.

## November 2025 Updates

### Legacy FRY 1.0 verification stakes
- Added `legacy_stake_unlocked` to `devices` to identify miners still staked with the retired FRY 1.0 asset.
- New CLI (`npm run unlock-legacy-verification`) reports the legacy cohort, supports `op://` secrets, and with `--apply`/`--force-unverify` can both set the flag and drop `verified` after the broadcast deadline (`LEGACY_VERIFICATION_FORCE_UTC` or `NEXT_PUBLIC_LEGACY_VERIFICATION_FORCE_UTC`).
- Dashboard changes:
  - Flagged miners see a “Withdraw Legacy Stake” action and warning; the withdraw modal always enables for FRY 1.0 stakes and bypasses the old 24 h/180 d lock when `legacy_stake_unlocked` is true.
- Legacy UX callouts:
  - Device list cards show a golden warning block + “Legacy Stake” badge, and expose both compact and large “Withdraw Legacy Stake” buttons so the action is available even when the card is collapsed.
  - History (`pages/history.tsx`) mirrors the same warning card above the stake tables and highlights active stake locks with clearer countdown copy.
  - Floating totals (`components/FloatingTotalsWidget.tsx`) now separates the tFry totals from a gold “Legacy FRY 1.0 claimed snapshot” with a “conversion to tFry tool coming soon” teaser.
  - Withdraw dialogs (legacy + standard) require an explicit acknowledgement that you lose the multiplier, use high‑contrast palettes for dark mode, and show the same guidance everywhere (device card, devices list, history).
- `/api/stake/withdrawable` returns availability metadata (including the legacy unlock flag) for these devices. `/api/stake/stake-withdraw` fills in missing FRY 1 IDs, skips the lock, and clears the flag, while `/api/stake/verification` clears it once the user re-stakes with FRY 2.0.

### Instant Claim fee handling
- Instant Claim on tFry now diverts the 30 % fee directly to `FRYALGO_WALLET` as tFry (no Tinyman swap). fNODE/fVPN rewards still swap their fee slice to FRY 2.0.
- Boost analytics log per-asset fee totals so ops can see how much arrived in tFry versus FRY 2.0.

## Data Model (MongoDB)

Database: `main`

- `devices`: per device registration (miner or node)
  - Ownership and profile: `address` (owner wallet), `email`, `name`, `nickname`
  - Reward wallet: `reward_wallet` (destination for claims)
  - Location: `position { lat, lng }`
  - Status flags: `is_registered`, `verified`, `registered_portal_model`, `hexId`
  - Staking blocks:
    - `registration`: `{ amount, txId, asset_id, time }`
    - `node`: `{ amount, txId, asset_id, time }`
    - `staked` (verification): `{ type, amount, txId, asset_id?, time, rewarded_time? }`
  - Type: `lib/types.ts:3`

- `products`: config for each product key (e.g., HWM, OSM, RDN, AEM)
  - `reward.tokens`: `{ stake, reward, register, node }` — asset ids (string) or `"none"`
  - `reward.stake`: `{ stake_one, stake_two, register, node }` — USD amounts
  - Type: `lib/types.ts:75`

- `device-rewards`: single source of truth for rewards per device
  - `weekly_rewards`: post‑cutoff records; fields include `reward_number`, `status` (`pending|claimable|claimed`), `asset_id`, `amount`, `unlock_at`, `tx_id`, `claimed_at`, and week boundaries for UI.
  - `daily_rewards`: pre‑cutoff history used for totals and display.

- `registration-users`: NextAuth wallet users.

- `tokens`: ASA metadata lookups (name/asset_id).

- `reward-boosts`: Instant Claim fee records.

- `fry-conversions`: FRY 1.0 vesting → monthly claims in FRY 2.0 or fNODE.

Database: `creds`
- Portal credential collections (`air`, `camera`, `energy`, `weather`, `water`, `radiation`, `hardware`, `other`) keyed by `miner_key` + owner `address`.
  - Persist: `pages/api/devices/save-credentials.ts:1`
  - Fetch: `pages/api/credentials/get.ts:1`
  - Validate: `pages/api/credentials/validate.ts:1` (+ vendor endpoints under `/api/credentials/*`)
  - Unlink/reset: `pages/api/credentials/unlink.ts:1`


## Wallets

- Sign‑in wallet: proves ownership; becomes the device owner (`devices.address`).
- Reward wallet: per-device wallet to receive claims; must be opted-in to the product’s reward ASA.
  - Validation during onboarding and update via `pages/api/devices/save-wallet-info.ts:1`.


## Registration and Onboarding

1) Start a registration
- Start: `pages/new_registration.tsx:1` (validates miner key, checks BYOD, brings up modal)
- Complete details: `pages/register.tsx:1`

2) Provide device details
- Device info (email, names, nickname): `pages/api/devices/save-device-info.ts:1`
- Reward wallet (must be opted-in to reward ASA): `pages/api/devices/save-wallet-info.ts:1`
- Location (latitude/longitude): `pages/api/devices/save-map-info.ts:1`
- Third-party portal credentials handled locally (AirAPI no longer required):
  - Fetch existing: `pages/api/credentials/get.ts:1`
  - Validate via registry/delegates: `pages/api/credentials/validate.ts:1`
  - Persist to `creds`: `pages/api/devices/save-credentials.ts:1`
  - Unlink/reset: `pages/api/credentials/unlink.ts:1`

3) Staking (as required by product)
- Registration staking
  - Token: `product.reward.tokens.register`
  - API: `pages/api/stake/registration.ts:1` → writes `device.registration`
- Node operation staking
  - Token: `product.reward.tokens.node`
  - API: `pages/api/stake/node-staking.ts:1` → writes `device.node`
- Verification staking (multiplier)
  - Token: `product.reward.tokens.stake`, amounts: `product.reward.stake.stake_one|stake_two`
  - API: `pages/api/stake/verification.ts:1` → writes `device.staked` and `verified: true`
  - All staking flows share `components/modals/Stake.tsx`. Before prompting the wallet to sign an ASA transfer, the modal calls `/api/stake/precheck` (backed by `lib/api/operationRateLimit.ts:peekOperationRateLimit`) to ensure the current wallet/IP combo has not exceeded the rate limit. Users now see a toast immediately instead of signing when throttled.
  - Legacy `components/modals/StakeVerification.tsx` remains for the FRY 1.0 modal in `pages/my_registrations.tsx` but new behavior should use the shared modal.
  - Buttons now include an amber warning block explaining that withdrawing removes multipliers until re-staked.

4) Cancelling a partial registration
- Clears registration/node blocks and address when appropriate: `pages/api/registrations/cancel.ts:1`


## Rewards

Concepts
- Rewards are recorded per device in `device-rewards`.
- Weekly mode is active post‑cutoff (`WEEKLY_CUTOFF_UTC`); a new reward epoch is computed from Friday 00:00 UTC and unlocks Friday 00:05 UTC the following week.
- Daily entries pre‑cutoff are retained for history and totals.

APIs
- Per‑device summary (pending/claimable/claimed + this week accrual and next unlock): `pages/api/rewards/get-reward-summary.ts:1`
- Aggregated totals across devices by asset (tFry, fNODE): `pages/api/rewards/get-asset-totals.ts:1`
- Paged history (mixed weekly + historical daily): `pages/api/rewards/get-rewards-page.ts:1`
- Claim: `pages/api/rewards/claim.ts:1`
  - Groups selected claimable entries by `asset_id` and sends a grouped ASA transfer to the device’s `reward_wallet`.
  - Sender mnemonic and rekey come from env vars (`REWARD_MNEMONIC`, `REWARD_REKEY`).
  - Updates `weekly_rewards`/`daily_rewards` statuses and adjusts totals.
  - Confirmation endpoint sets on‑chain timestamp: `pages/api/rewards/confirm.ts:1`
- Instant Claim (Boost): `pages/api/rewards/boost.ts:1`
  - Converts a 30% fee to FRY 2.0 (via Tinyman swaps when needed) and sends to `FRYALGO_WALLET`.
  - Updates rewards from `pending → claimable` at 70% and adjusts totals.
  - The UI still enforces a 0.001 ALGO top-up to the user’s reward wallet before each claim/boost so the custodial sender has Algo to pay the outbound transaction fee; skipping this step blocks the claim.


## Withdrawals

- Verification stake: `pages/api/stake/stake-withdraw.ts:1`
  - Available after 24h for `type=one` or 180 days for `type=two`, or immediately if the product stake asset changed since staking.
  - Legacy FRY 1.0 devices bypass the time lock once `legacy_stake_unlocked` is set, and each withdraw modal forces the user to acknowledge that they will lose the multiplier until re-staking with FRY 2.0.
- Registration stake: `pages/api/stake/r-withdraw.ts:1`
- Node operation stake: `pages/api/stake/n-withdraw.ts:1`


## Tokens (What earns/what stakes)

These are product-driven; the app reads `products` to decide tokens and staking amounts. Built‑in ids for reference are in `lib/utils.ts:24`.

- Miners
  - Rewards: tFry
  - Verification staking: FRY 2.0 or `products.reward.tokens.stake`

- Nodes and AEM
  - Rewards: fNODE
  - Registration staking: fNODE (via `products.reward.tokens.register`)
  - Node operation staking (for SDN/SVN/RDN): fNODE (via `products.reward.tokens.node`)
  - Verification staking (multiplier): FRY 2.0 (via `products.reward.tokens.stake`)

Note: The exact assets are controlled centrally by the `products` collection; update there to change behavior across the app.


## Environment Variables

Required
- `MONGO_URI` — connection string
- `NEXTAUTH_SECRET` — NextAuth JWT secret
- Rewards sender: `REWARD_MNEMONIC`, `REWARD_REKEY`
- Stake withdraw sender: `STAKE_MNEMONIC`, `STAKE_REKEY`

Feature flags
- `NEXT_PUBLIC_TEST_MODE=true|false` — read/write test collections for devices
- `NEXT_PUBLIC_DEV_MODE=true|false` — relaxes some timing/asset checks
- `WEEKLY_REWARDS_ENABLED=true|false` or `NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED`
- `WEEKLY_CUTOFF_UTC=YYYY-MM-DDTHH:mm:ss.sssZ`
- Seasonal overrides: `NEXT_PUBLIC_FORCE_SEASONAL_THEME`, `NEXT_PUBLIC_DISABLE_SEASONAL_AUTO`

Bug reporting
- `DISCORD_BUG_WEBHOOK_URL` — Discord webhook that receives submitted bug reports (required to enable the UI button)
- `BUG_REPORT_RATE_LIMIT_MINUTES` — optional override for the submission cooldown window in minutes (defaults to 120 minutes; users may submit up to two reports per window). Legacy `BUG_REPORT_RATE_LIMIT_HOURS` is still honored if the minutes variable is not set.

Hardware DB (optional)
- `MONGO_CREDS_DB`, `MONGO_CREDS_COLLECTION`
- Validator endpoints live under `/api/credentials/hardware/*`; MAC-specific logic in `pages/api/credentials/hardware/mac.ts:1`

DIMO (server)
- `DIMO_CLIENT_ID`, `DIMO_CLIENT_SECRET`, `DIMO_REDIRECT_URI`, `DIMO_HASH_SECRET` (>=32 chars), `DIMO_LOGIN_BASE`, `DIMO_JWKS_URL`, `DIMO_API_BASE`
- Policy knobs: `DIMO_ANNOUNCE_UTC`, `DIMO_GRACE_DAYS`, `DIMO_REQUIRE_ANNUAL_POST_ANNOUNCE`, `DIMO_ALLOW_POST_GRACE`, `DIMO_SNAPSHOT_TTL_MINUTES`, `DIMO_MINER_PREFIX`

DIMO (public)
- `NEXT_PUBLIC_DIMO_CLIENT_ID`, `NEXT_PUBLIC_DIMO_REDIRECT_URI`, `NEXT_PUBLIC_DIMO_ENV`


## Key UI Entry Points

- Devices: `pages/devices.tsx:1` (overview, actions, staking/boost/claim modals)
- My registrations (legacy staking path): `pages/my_registrations.tsx:1`
- Registration wizard & staking modals: `pages/register.tsx:1` and device actions in `pages/devices.tsx:1`
- Hardware portal: `pages/nodeportal.tsx:1`
- Sign in: `pages/signin.tsx:1`


## DIMO Airdrop Integration

- Login with DIMO uses the hosted SDK (UserJWT) with CSRF state.
  - Start: `/api/dimo/start` sets a short-lived `dimo_oauth_state` cookie and returns the login URL built from `DIMO_LOGIN_BASE`.
  - Callback/sync: `/api/dimo/callback` verifies state, validates the UserJWT against JWKS (`DIMO_JWKS_URL`, `aud=DIMO_CLIENT_ID`, `iss=https://auth.dimo.zone`), fetches account + `/subscription/status/all`, hashes identifiers (`hashDimoId`), runs eligibility (`lib/dimo/eligibility.ts`), and upserts `main.dimo-subscriptions` (test collection when `NEXT_PUBLIC_TEST_MODE=true`).
  - Eligibility surface: `/api/dimo/eligible` returns cached verdicts for the session wallet; all `/api/dimo/*` handlers reuse the standard client token + HMAC + fingerprint + session stack.
- Claim flow issues one free AEM miner key per eligible subscription:
  - `/api/dimo/claim` guards with `enforceWalletApiSecurity`, rate limits, and `withDeviceActionLock`.
  - Ensures the DIMO snapshot is fresh (`DIMO_SNAPSHOT_TTL_MINUTES`), generates a unique miner key (`DIMO_MINER_PREFIX`, default `AEM`), inserts the device stub (order derived from wallet), and stores hashed key + checksum on the subscription.
- Eligibility policy:
  - Requires active/trial status and a valid start date.
  - Pre-announcement subscriptions are eligible; within the grace window (`DIMO_GRACE_DAYS`) requires annual unless `DIMO_REQUIRE_ANNUAL_POST_ANNOUNCE=false`; post-grace is blocked unless `DIMO_ALLOW_POST_GRACE=true`.
  - Grace expiry is stored on the subscription for UI messaging.
- UI: `pages/dimo.tsx` with `DimoLoginSection` (SDK wrapper), signed requests to `/api/dimo/*`, eligibility grid, claim CTA, and rate-limited sync (`dimo:sync`).


## Seasonal Themes

- SeasonalThemeProvider auto-enables holiday accents one month before through the day after each holiday (Christmas, Valentine’s Day, Easter, July 4th, Thanksgiving) and writes `data-holiday-theme` on `<html>` for CSS.
- Overrides:
  - `NEXT_PUBLIC_FORCE_SEASONAL_THEME` can force a holiday or disable with `off|none|disable`.
  - `NEXT_PUBLIC_DISABLE_SEASONAL_AUTO` disables automatic detection; user toggle still works unless forced off.
  - User preference persists in `localStorage` (`seasonal-theme-enabled`).
- UI controls: `components/ThemeControls.tsx` (light/dark/seasonal toggle) and `components/SeasonalThemeBadge.tsx` (badge for active holiday).


## Security Notes

- All server routes check `session.user.address` against request `address`.
- Reward wallet must be opted‑in to the reward ASA; the UI enforces this with server‑side balance checks.


## Local Development

1) Setup `.env` with Mongo URI, NextAuth secret, and required mnemonics.
2) `npm install`
3) `npm run dev`
4) Sign in at `/signin`; connect a supported Algorand wallet.

## Support CLI — RTSP quick check

For support and debugging, there's a small CLI that uses the shared RTSP checker:

```bash
# from repo root
node scripts/check-rtsp.js rtsp://user:pass@203.0.113.10:554/stream
```

The script prints a structured result and exits with:
- 0 when the RTSP check succeeds
- 1 when the RTSP check fails
- 2 for usage errors or unexpected exceptions

This CLI calls the same `lib/rtspCheck.ts` implementation used by the server APIs so results match what the backend would report.


# Codex Findings :
## November 16th 2025 : 
### Reward Flows

Claim modal preps signed requests client-side, including preview + fee payment, before calling /api/rewards/claim (components/modals/Claim.tsx (lines 95-205)). The endpoint layers client token, HMAC signature, fingerprint, and NextAuth session checks (pages/api/rewards/claim.ts (lines 95-158)), then wraps execution in withDeviceActionLock/Mongo locks to serialize actions and emit journals (lib/api/deviceAction.ts (lines 70-174), lib/db/requestLocks.ts (lines 5-162)). It loads the device + device-rewards doc, ensures the reward wallet is set and opted-in (pages/api/rewards/claim.ts (lines 187-236)), aggregates weekly + legacy daily records, and broadcasts grouped ASA transfers via the custodial reward vault (pages/api/rewards/claim.ts (lines 238-330)). Post-broadcast it updates weekly_rewards/daily_rewards, total counters (total_*), and logs monitoring events (pages/api/rewards/claim.ts (lines 332-414)). Claim confirmations backfill on-chain timestamps via /api/rewards/confirm (pages/api/rewards/confirm.ts (lines 74-135)).

Boost (Instant Claim) follows the same security layers but works on pending rewards only. UI signs requests with client token/signature (components/modals/Boost.tsx (lines 63-149)), then /api/rewards/boost validates ownership, loads device-rewards, and builds per-asset boost adjustments (pages/api/rewards/boost.ts (lines 200-370)). 30 % fees are routed to FRYALGO_WALLET, swapping fNODE/fVPN into FRY 2 on Tinyman when needed (pages/api/rewards/boost.ts (lines 95-190), 356-421), while total_pending, total_claimable, and per-asset counters are updated atomically (pages/api/rewards/boost.ts (lines 421-480)). Every boost is journaled, logged to reward-boosts, and monitored afterward.

### Staking & Withdrawals

User staking always originates from the wallet modal. The shared StakeModal enforces balance/opt-in checks, signs ASA transfers to the custodial stake address with detailed notes, and immediately posts the tx metadata to the relevant API (components/modals/Stake.tsx (lines 213-470)). For verification staking, /api/stake/verification revalidates security headers, ensures the wallet is opted into the staking asset, and updates the devices.staked block (history, withdrawals, legacy unlock flag) plus verified=true (pages/api/stake/verification.ts (lines 24-174)). Registration and node staking use the same pipeline with their own handlers (pages/api/stake/registration.ts (lines 24-129), pages/api/stake/node-staking.ts (lines 24-129)), but gate availability via products.reward.tokens.register/node.
Withdrawals use two steps: /api/stake/withdrawable evaluates lock timers, product tokens, and legacy overrides to tell the UI when a verification stake can exit (pages/api/stake/withdrawable.ts (lines 19-129), lib/legacyStake.ts (lines 7-44)). When the user proceeds, /api/stake/stake-withdraw, /api/stake/r-withdraw, or /api/stake/n-withdraw re-run security checks, ensure the recipient wallet has opted into the asset, and broadcast Algorand transfers via shared custodial helpers (pages/api/stake/stake-withdraw.ts (lines 36-205), pages/api/stake/r-withdraw.ts (lines 36-152), pages/api/stake/n-withdraw.ts (lines 36-165)). Each flow logs to Mongo history (devices.*.history/withdrawals), clears active stake fields, and emits transaction monitoring events (pages/api/stake/stake-withdraw.ts (lines 138-205), etc.). Legacy FRY 1.0 unlocks are detected via lib/legacyStake.ts (lines 18-40) and bypass both timing locks and missing asset_id metadata.

### Totals & History Surfaces

Device cards fetch per-miner summaries through useRewardSummary, which signs every request and retries on fingerprint refresh (lib/hooks/useRewardSummary.ts (lines 18-65)). The API blends aggregated total_* counters with weekly/daily arrays, but filters allowed assets based on device type (miners vs node/AEM) and tracks legacy FRY snapshots separately (pages/api/rewards/get-reward-summary.ts (lines 124-256)).
The floating ribbon aggregates all devices owned by the session. pages/devices.tsx (lines 870-980) schedules signed polls to /api/rewards/get-asset-totals, and components/FloatingTotalsWidget.tsx (lines 1-200) presents pending/claimable/accruing balances plus an estimated weekly projection. On the backend the totals endpoint loads every device for the wallet, distinguishes miner vs node assets, and rolls up device-rewards documents (including weekly accrual previews and legacy FRY bonuses) with fingerprint + signature protection (pages/api/rewards/get-asset-totals.ts (lines 118-320)).
History SSR seeds the first page straight from Mongo: getServerSideProps slices current weekly vs legacy daily arrays and builds the UI-friendly shape (pages/history.tsx (lines 1365-1458)). Client-side pagination and filtering later rely on /api/rewards/get-rewards-page and /api/rewards/get-reward-records, both of which enforce the same four-layer security stack and decorate records with progress/ETA and fiat valuations (pages/api/rewards/get-rewards-page.ts (lines 17-199), pages/api/rewards/get-reward-records.ts (lines 17-200)). Stake timelines come from collectStakeHistory, which flattens each devices.* stake block (history + withdrawals) into chronological events for the tab view (lib/history/collectStakeHistory.js (lines 52-166)).

### Key Collections & Schemas

main.devices stores owner profile, reward wallet, geo, and three stake segments (registration, node, staked) plus histories (lib/types.ts (lines 3-94)). APIs mutate these blocks during staking/withdrawing, and the history helper snapshots additional metadata by backfilling withdrawal transactions when necessary (pages/api/devices/[miner_key].ts (lines 200-320)).
main.products defines staking tokens/amounts per product key and drives permission logic for registration/node staking (lib/types.ts (lines 75-105), lib/utils.ts (lines 182-244)).
main.device-rewards is the SoT for reward accrual. Each doc holds weekly_rewards, daily_rewards, total aggregates (total_*), and legacy FRY snapshots; all reward APIs touch this collection when changing statuses or totals (pages/api/rewards/claim.ts (lines 332-414), pages/api/rewards/boost.ts (lines 267-421), pages/api/rewards/get-reward-summary.ts (lines 174-256)).
main.reward-boosts captures every instant-claim fee payment with per-asset fee maps for audit (pages/api/rewards/boost.ts (lines 421-454)).
main.registration-users backs NextAuth and the admin bypass checks (lib/adminCheck.ts (lines 5-44)).
Concurrency/audit data lives in main.device_request_locks and main.device_transactions (lib/db/requestLocks.ts (lines 5-162)), while wallet UX locking uses main.wallet_operation_locks (lib/wallet/requestCoordinator.ts (lines 5-120)). Security telemetry (client token/signature/fingerprint failures) rolls up inside main.security-events (lib/securityEventAggregation.ts (lines 1-138)).

### Security & Environment

Every sensitive endpoint stacks: client token HMAC (browser-only), HMAC request signature with 5‑minute TTL, fingerprint binding to the login device, and NextAuth session ownership (see claim/boost/summary/totals handlers cited above). Server-side actions then enter withDeviceActionLock to enforce idempotency + rate limiting before touching Mongo or Algorand (lib/api/deviceAction.ts (lines 48-156), lib/api/operationRateLimit.ts (lines 5-86)), and important broadcasts are monitored via Discord webhooks (lib/monitoring/walletHealth.ts (lines 1-86), lib/monitoring/transactionMonitor.ts (lines 1-52)).
Custodial wallets and env secrets are supplied via Docker Compose: Algorand signer mnemonics/rekeys, Mongo URIs, NextAuth secrets, Discord webhooks, weekly cutoff flags, and legacy force timestamps (docker-compose.yml (lines 5-41)). FINAL_DEP_WALLET_PLAN.md tracks the completed security/wallet hardening work and remaining backlog for future PRs.
I’ve walked the full reward → staking → withdrawal → totals pipeline, mapped their code paths, and noted every collection touched. Let me know what questions you have or which issue you’d like to tackle first.


## December 1st 2025 updated findings : 

### Reward flows: 
Claim modal signs with client token + HMAC and enforces the 0.001 ALGO top-up. /api/rewards/claim stacks session + fingerprint + signature + client token, wraps in withDeviceActionLock/Mongo locks, enforces reward wallet opt-in, aggregates weekly + legacy daily entries, broadcasts grouped custodial ASA transfers, updates weekly_rewards/daily_rewards totals, and logs monitoring/Discord events. /api/rewards/confirm backfills on-chain timestamps. Boost works on pending rewards; /api/rewards/boost validates ownership, computes per-asset fee maps, charges 30% (tFry direct to FRYALGO_WALLET; fNODE/fVPN swap to FRY 2.0 via Tinyman), flips to claimable at 70%, adjusts totals atomically, journals to reward-boosts, and notifies Discord.

### Staking & withdrawals: 
components/modals/Stake.tsx does rate-limit precheck (/api/stake/precheck), balance/opt-in checks, signs ASA transfers, and posts tx metadata. /api/stake/verification|registration|node-staking revalidate headers, ensure opt-in to product token, update device stake blocks + history, and set verified while clearing legacy flags on verification stake. Withdrawals (/api/stake/stake-withdraw, /api/stake/r-withdraw, /api/stake/n-withdraw) re-check opt-in and locks/timers (legacy bypass where flagged), broadcast from custodial vaults, append history, clear active stake fields, and log monitoring events. /api/stake/withdrawable exposes availability and legacy unlock metadata.

### Totals & history surfaces: 
Device cards and floating totals poll /api/rewards/get-reward-summary and /api/rewards/get-asset-totals with the full security stack, merging pending/claimable/claimed totals, weekly accrual previews, next unlocks, and legacy FRY snapshots. History SSR + pagination (pages/history.tsx, /api/rewards/get-rewards-page) blend weekly and historical daily rewards with fiat estimates and stake timelines from lib/history/collectStakeHistory.js.

### DIMO integration: 
/api/dimo/start sets CSRF state + hosted Login with DIMO URL. /api/dimo/callback verifies state, validates UserJWT via JWKS (DIMO_JWKS_URL, aud=DIMO_CLIENT_ID, iss=https://auth.dimo.zone), fetches account + /subscription/status/all, hashes IDs (hashDimoId), evaluates eligibility (lib/dimo/eligibility.ts), and upserts main.dimo-subscriptions (test collections when NEXT_PUBLIC_TEST_MODE=true) with audit trail and wallet/user conflict checks. /api/dimo/eligible returns cached verdicts. /api/dimo/claim locks per subscription, enforces fresh snapshot (DIMO_SNAPSHOT_TTL_MINUTES), generates a unique miner key (DIMO_MINER_PREFIX, default AEM), inserts a device stub, and stores hashed key + checksum (one free AEM per eligible sub). Eligibility: active/trial + start date; pre-announce allowed; grace window (DIMO_GRACE_DAYS) requires annual unless DIMO_REQUIRE_ANNUAL_POST_ANNOUNCE=false; post-grace blocked unless DIMO_ALLOW_POST_GRACE=true. Grace expiry persisted for UI copy.

### Seasonal themes: 
SeasonalThemeProvider auto-activates holiday accents one month before through the day after Christmas, Valentine’s, Easter, July 4th, and Thanksgiving (lib/holidays.ts), writing data-holiday-theme on <html>. Overrides: NEXT_PUBLIC_FORCE_SEASONAL_THEME (force/disable), NEXT_PUBLIC_DISABLE_SEASONAL_AUTO (stop auto detection); user toggle persists in localStorage (seasonal-theme-enabled). UI surfaced via ThemeControls (light/dark/seasonal) and SeasonalThemeBadge.

### Key collections & concurrency: 
Authoritative collections: main.devices, main.products, main.device-rewards, main.reward-boosts, main.registration-users, main.dimo-subscriptions; creds in creds.*. Locks/journals: main.device_request_locks, main.device_transactions; wallet UX locks: main.wallet_operation_locks; security telemetry: main.security-events. Custodial secrets + policy flags (Algorand mnemonics/rekeys, Mongo URIs, NextAuth, Discord, weekly cutoff, legacy force timestamps, DIMO secrets) are sourced via docker-compose/1Password.