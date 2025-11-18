# Agent Guide — user-dashboard

This guide gives agents and contributors a big‑picture map of the user-dashboard codebase so you can work productively without re‑discovering how things fit together. It summarizes architecture, data models, flows, tokens, and where to change behavior.

Scope: this file documents the user-dashboard Next.js app only. Ignore `.next/` and `node_modules/`.


## Tech Stack

- Next.js (pages router) with some app/ UI scaffolding
- NextAuth (custom credentials provider for Algorand wallet auth)
- MongoDB via a shared client (`lib/mongoclient.ts`)
- Algorand (wallets via `@txnlab/use-wallet(-react)`, sdk operations, indexer)
- Tinyman SDK for swaps used by Instant Claim Boost
- Internal credential APIs (`/api/credentials/*`, `/api/devices/save-credentials`) replacing the legacy AirAPI service


## High-Level Architecture

- Authentication is handled by a custom NextAuth provider that verifies a signed Algorand transaction and stores basic user profile in MongoDB.
  - Code: `lib/WalletAuthProvider.ts:6`, `lib/auth.ts:5`.
- All application data lives in MongoDB `main` (plus a separate `creds` DB for portal credentials and hardware MAC credentials).
  - Shared client: `lib/mongoclient.ts:1`.
- Devices (aka registrations) are stored per wallet, with per-device staking state, reward wallet, nickname, and position.
  - Type: `lib/types.ts:3`.
- Device credentials are managed in-app:
  - Fetch: `pages/api/credentials/get.ts:1`
  - Validate/delegate: `pages/api/credentials/validate.ts:1`, validator registry `lib/validators/DeviceValidatorRegistry.ts:1`
  - Persist: `pages/api/devices/save-credentials.ts:1`
  - Unlink: `pages/api/credentials/unlink.ts:1`
- Products drive token choices and required staking amounts for registration, node operation, and verification.
  - Type: `lib/types.ts:75`.
- Rewards are the source of truth in the `device-rewards` collection (weekly + legacy daily), with API to page, total, claim, boost (instant claim), and confirm on-chain timestamps.
  - Claim: `pages/api/rewards/claim.ts:1`
  - Boost: `pages/api/rewards/boost.ts:1`
  - Totals/Summary/Paging: `pages/api/rewards/get-asset-totals.ts:1`, `pages/api/rewards/get-reward-summary.ts:1`, `pages/api/rewards/get-rewards-page.ts:1`


## Databases and Collections

- Database: `main`
  - `registration-users`: next-auth wallet users; fields: `address`, `email`, `first_name`, `last_name`
    - Write path: `lib/WalletAuthProvider.ts:36`
  - `devices`: one doc per miner/node; core fields include:
    - `address` (owner/sign-in wallet), `email`, `name`, `nickname`, `reward_wallet`,
    - `position` `{ lat, lng }`, `is_registered`, `verified`, `registered_portal_model`, `hexId`
    - staking blocks:
      - `registration`: `{ amount, txId, asset_id, time }`
      - `node`: `{ amount, txId, asset_id, time }`
      - `staked` (verification): `{ type, amount, txId, asset_id?, time, rewarded_time?, withdraw_boost }`
    - Type ref: `lib/types.ts:3`
  - `products`: per product (e.g., miner types, node types) with reward + staking configuration
    - `reward.tokens`: `{ stake, reward, register, node }` (asset ids or `"none"`)
    - `reward.stake`: `{ stake_one, stake_two, register, node }` (USD amounts)
    - Type ref: `lib/types.ts:75`
  - `device-rewards`: single source of truth for rewards per device
    - `weekly_rewards` (post-cutoff) and `daily_rewards` (pre-cutoff history)
    - APIs compute totals, weekly windows, and handle status transitions
  - `reward-boosts`: instant-claim fee records (created by boost)
  - `tokens`: metadata lookups for asset id → token name (used in UI)
  - `fry-conversions`: FRY 1.0 vesting conversion → FRY 2.0 or fNODE monthly claims

- Database: `creds`
  - Portal credential collections (`air`, `camera`, `energy`, `weather`, `water`, `radiation`, `hardware`, `other`) keyed by `miner_key` + owner `address`
    - Persist: `pages/api/devices/save-credentials.ts:1`
    - Fetch: `pages/api/credentials/get.ts:1`
    - Validate: `pages/api/credentials/validate.ts:1` (+ vendor endpoints under `/api/credentials/*`)
    - Unlink/reset: `pages/api/credentials/unlink.ts:1`


## Wallets

- Sign-in Wallet: the Algorand address that authenticates with NextAuth; stored as `registration-users.address` and copied to `devices.address` on registration.
- Reward Wallet: per-device wallet that receives claim payouts; stored on the device as `reward_wallet`.
  - Update API: `pages/api/update-reward-wallet.ts:1` and during onboarding at `pages/api/devices/save-wallet-info.ts:1`

## November 2025 Operational Notes

- **Legacy FRY 1.0 verification sunset**
  - Devices now carry `legacy_stake_unlocked`. Use `npm run unlock-legacy-verification [--apply|--force-unverify --force-after <ISO>]` to report/flag the cohort. The script understands `op://` URIs and can flip `verified` to false once the cutoff hits (`LEGACY_VERIFICATION_FORCE_UTC` or `NEXT_PUBLIC_LEGACY_VERIFICATION_FORCE_UTC`).
  - Dashboard surfaces “Withdraw Legacy Stake” + warnings for flagged miners only. `/api/stake/withdrawable` short-circuits them to `{ available: true, legacy: true }`, and `/api/stake/stake-withdraw` bypasses the lock for FRY 1.0 while clearing the flag after a successful withdrawal. `/api/stake/verification` resets the flag when FRY 2.0 staking succeeds.
  - UX callouts:
    - Device cards (`components/DeviceListItem.tsx`) show an amber “Legacy Stake” badge, golden warning block, and both compact + full “Withdraw Legacy Stake” buttons so users see the action even before expanding the card.
    - Floating Totals (`components/FloatingTotalsWidget.tsx`) now separates the tFry totals from a gold “Legacy FRY 1.0 claimed snapshot” card that advertises the upcoming conversion tool.
    - History view (`pages/history.tsx`) mirrors the device warning (gold rounded rectangle with the “Legacy FRY 1.0 verification stake detected. Withdraw…” copy) and adds clearer lock-progress rows for each staking category.
    - Withdraw modals (legacy + standard) require an explicit “I understand I’ll lose the multiplier” acknowledgement, have dark-mode friendly palettes, and display white text buttons so the warnings remain legible.
- **Instant Claim fees**
  - tFry instant-claim fees now go straight to `FRYALGO_WALLET` as tFry (no Tinyman swap). fNODE/fVPN still swap to FRY 2.0. Boost analytics store a per-asset fee map (`fee_assets`) so ops can audit how much arrived as tFry vs FRY 2.0.

## Flows — End to End

1) Sign In with Wallet
- UI: `pages/signin.tsx:1`
- Creates a 0-ALGO payment transaction whose note encodes a challenge string, user signs it, backend verifies signature and note.
  - Verify: `lib/auth.ts:5`
- On success, user record is upserted in `registration-users` and a JWT session is issued.
  - Provider: `lib/WalletAuthProvider.ts:18`

2) Start Registration (Create device record and complete details)
- Paths: `pages/new_registration.tsx:1` to start; `pages/register.tsx:1` to complete details.
- Save device info (email, names, nickname): `pages/api/devices/save-device-info.ts:1`
- Save reward wallet (must be opted-in to reward token): `pages/api/devices/save-wallet-info.ts:1`
- Save location (lat/lng): `pages/api/devices/save-map-info.ts:1`
- Manage third-party credentials inside the dashboard (AirAPI fully retired):
  - Fetch existing: `pages/api/credentials/get.ts:1`
  - Validate via registry + vendor delegates: `pages/api/credentials/validate.ts:1`
  - Persist to `creds` DB: `pages/api/devices/save-credentials.ts:1`
  - Unlink/reset: `pages/api/credentials/unlink.ts:1`

3) Staking
- Registration Staking
  - Asset: `product.reward.tokens.register`
  - UI: device actions (`components/DeviceListItem.tsx`) open the Stake modal in registration mode
  - API: `pages/api/stake/registration.ts:1` (writes `device.registration`)
- Node Operation Staking
  - Asset: `product.reward.tokens.node`
  - UI: device actions (`components/DeviceListItem.tsx`) open the Stake modal in node mode
  - API: `pages/api/stake/node-staking.ts:1` (writes `device.node`)
- Verification Staking (multiplier)
  - Generic modal: `components/modals/Stake.tsx` uses `product.reward.tokens.stake` and amounts `product.reward.stake.{stake_one,stake_two}`; API `pages/api/stake/verification.ts:1` (writes `device.staked` and `verified: true`).
- Legacy modal (FRY 1.0 only): `components/modals/StakeVerification.tsx` now posts to the shared `/api/stake/verification` endpoint (the old `/api/verify-stake` route has been removed). Prefer the generic modal for new behavior; this legacy view is kept solely for `my_registrations` until it can be retired.

4) Rewards
- Accrual and Storage
  - Rewards recorded in `device-rewards` as weekly (post-cutoff) and daily (pre-cutoff history).
  - Weekly unlock window (Friday 00:05 UTC) and cutoff are governed by env vars; APIs compute current week, accrual preview, next unlock.
    - Logic: `pages/api/rewards/get-asset-totals.ts:11`, `pages/api/rewards/get-reward-summary.ts:11`
- Claim
  - Groups claimable records by `asset_id`, sends grouped ASA transfers to the device’s `reward_wallet`.
  - Sender mnemonic/rekey via env. Updates `weekly_rewards`/`daily_rewards` statuses and totals.
  - API: `pages/api/rewards/claim.ts:1`, confirm: `pages/api/rewards/confirm.ts:1`
  - Instant Claim (Boost)
  - Charges a flat 30% fee in the minted asset: tFry fees go straight to `FRYALGO_WALLET` as tFry (no Tinyman swap) while fNODE/fVPN fees are swapped into FRY 2.0 via Tinyman before hitting the same destination.
  - Marks selected rewards pending → claimable at 70% and adjusts totals.
  - API: `pages/api/rewards/boost.ts:1`
  - Reward wallet top-up: the UI still forces users to send 0.001 ALGO to their reward wallet before each claim/boost so the custodial sender has enough Algo to pay the outbound transaction fee; this happens even if the wallet has been opted in for months.
- Legacy FRY 1.0 rewards are aggregated into the tFry totals/UI; the only remaining FRY 1.0 touchpoint is the conversion tooling for users who still need to burn old balances.

5) Withdrawals
- Verification stake withdraw: `pages/api/stake/stake-withdraw.ts:1` (24h for `type=one`, 180d for `type=two`, or allowed if product stake asset changed)
- Registration stake withdraw: `pages/api/stake/r-withdraw.ts:1`
- Node stake withdraw: `pages/api/stake/n-withdraw.ts:1`
- Rate limits + preflight:
  - All staking endpoints run through `withDeviceActionLock` + `enforceOperationRateLimit`. To avoid burning a wallet transaction when the limit is exceeded, the modal now calls `/api/stake/precheck` before asking the wallet to sign. This endpoint (backed by `peekOperationRateLimit`) mirrors the real limiter and returns a 429 right away, so users hit a toast instead of signing once throttled.
  - `components/modals/Stake.tsx` handles verification/registration/node staking with the new confirmation flow; legacy `components/modals/StakeVerification.tsx` is kept only for the FRY 1.0 modal on `my_registrations`.

6) Hardware Credentials (MAC)
- CRUD under a separate DB/collection: `creds.hardware`
- API: `pages/api/hardware/register.ts:1` (enforces linked miner key constraints, prevents conflicts) plus validator endpoint `pages/api/credentials/hardware/mac.ts:1` used by `/api/credentials/validate`


## Token Model and Products

The asset ids are product-driven and can differ by device type:

- Reward token per product: `product.reward.tokens.reward` (used to validate reward wallet opt‑in and for claims)
- Verification staking token per product: `product.reward.tokens.stake` (stake_one/stake_two amounts in USD)
- Registration staking token: `product.reward.tokens.register`
- Node operation staking token: `product.reward.tokens.node`

Constants (for reference): see `lib/utils.ts:24` for tFry, FRY 2.0, fNODE, fVPN ids.

Observed intent supported by code:
- Miners: verification staking in FRY 2.0 and rewards in tFRY.
- Nodes and AEM: rewards in fNODE; registration/node staking also in fNODE; verification staking uses FRY 2.0 as multiplier. This is enforced by the `products` collection; adjust there to change behavior.


## Environment

Required (examples in `.env`):
- `MONGO_URI` — connection string (both app and hardware creds use this)
- `NEXTAUTH_SECRET` — NextAuth JWT secret
- Algorand sender mnemonics:
  - Rewards: `REWARD_MNEMONIC`, `REWARD_REKEY`
  - Stake withdraw: `STAKE_MNEMONIC`, `STAKE_REKEY`
- Feature toggles:
  - `NEXT_PUBLIC_TEST_MODE=true|false`
  - `NEXT_PUBLIC_DEV_MODE=true|false`
  - `WEEKLY_REWARDS_ENABLED=true|false` (or `NEXT_PUBLIC_WEEKLY_REWARDS_ENABLED`)
  - `WEEKLY_CUTOFF_UTC=YYYY-MM-DDTHH:mm:ss.sssZ` (switch from daily → weekly SoT)
- Hardware DB overrides (optional): `MONGO_CREDS_DB`, `MONGO_CREDS_COLLECTION`


## Where to Change Things

- Product token or amount changes: update `products` collection (the app reads live each request)
- Weekly windows / cutoff: tune env vars above
- Claim or boost behavior: see `pages/api/rewards/*`
- Staking and withdrawals: see `pages/api/stake/*`, `pages/api/stake/precheck.ts`, and `components/modals/*`
- Announcements banner + tray entries: see `pages/api/announcements/*`, `app/notificationcontext.tsx`, and `components/AnnouncementBanner.tsx`
- Authentication rules: `lib/WalletAuthProvider.ts:18`, `lib/auth.ts:5`


## Conventions and Tips

- Always authorize server actions by comparing `session.user.address` with request `address`.
- Prefer `client.db('main')` collections; use test collections when `NEXT_PUBLIC_TEST_MODE === 'true'`.
- When building UI for staking, use product tokens and amounts; do not hardcode asset ids.
- Rewards SoT is `device-rewards`; legacy per-miner `rewards` is not used by the dashboard.
- Use `rg` (ripgrep) when searching; ignore `.next` and `node_modules`.


## Quick File Map

- Auth: `pages/api/auth/[...nextauth].ts:1`, `lib/WalletAuthProvider.ts:1`, `lib/auth.ts:5`
- Devices: `pages/register.tsx:1`, per-device actions in `components/DeviceListItem.tsx`, `pages/api/devices/*.ts`
- Staking: `components/modals/Stake.tsx:1`, `pages/api/stake/*.ts`
- Rewards: `pages/devices.tsx:1` (UI), `pages/api/rewards/*.ts`
- Hardware creds: `pages/nodeportal.tsx:1`, `pages/api/hardware/register.ts:1`


## Known Edge Cases

- The legacy verification modal (`components/modals/StakeVerification.tsx`) assumes FRY 1.0 and writes `staked` without `asset_id`, whereas the generic modal records `asset_id`. Prefer the generic modal for new flows; the withdraw API expects an `asset_id`.
(Needs updating as FRY 1.0 is retired as of October 9th 2025 and no longer used anywhere. Miners now earn tFry as rewards and stake FRY 2.0 for verification staking multipliers (1.5x or 3x depending on if type "one" (24hour lock) or type "two (6 months lock)))

- Reward wallet must be opted-in to the reward asset; UI enforces via `/api/algorand/get-token-balance`.


## Runbook (local)

- Provide `.env` with `MONGO_URI`, NextAuth secret, and required mnemonics.
- `npm i && npm run dev`
- Sign in at `/signin` with a supported Algorand wallet (Pera/Defly via `@txnlab/use-wallet`).
