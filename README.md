# user-dashboard — Architecture and Flows

This document explains how the Fry user dashboard works end‑to‑end: authentication, registration, staking, rewards, and data storage. It’s intended to be a standing reference so future contributors don’t need to re‑analyze the whole codebase.


## Overview

- Next.js app (pages router) with NextAuth for wallet login (Algorand).
- MongoDB for all state: users, devices, products, rewards, etc.
- Algorand network for staking/claims. Wallets via `@txnlab/use-wallet(-react)`.
- Rewards modeled weekly (with support for historical pre‑cutoff daily entries).


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
- `hardware`: MAC credentials by miner key/type (for portal linking).


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
  - Legacy variant (FRY 1.0 only) exists for the older registration UI: `pages/api/verify-stake.ts:1`

4) Cancelling a partial registration
- Clears registration/node blocks and address when appropriate: `pages/api/registrations/cancel.ts:1`


## Rewards

Concepts
- Rewards are recorded per device in `device-rewards`.
- Weekly mode is active post‑cutoff (`WEEKLY_CUTOFF_UTC`); a new reward epoch is computed from Friday 00:00 UTC and unlocks Friday 00:05 UTC the following week.
- Daily entries pre‑cutoff are retained for history and totals.

APIs
- Per‑device summary (pending/claimable/claimed + this week accrual and next unlock): `pages/api/rewards/get-reward-summary.ts:1`
- Aggregated totals across devices by asset (FRY 1.0, fNODE): `pages/api/rewards/get-asset-totals.ts:1`
- Paged history (mixed weekly + historical daily): `pages/api/rewards/get-rewards-page.ts:1`
- Claim: `pages/api/rewards/claim.ts:1`
  - Groups selected claimable entries by `asset_id` and sends a grouped ASA transfer to the device’s `reward_wallet`.
  - Sender mnemonic and rekey come from env vars (`REWARD_MNEMONIC`, `REWARD_REKEY`).
  - Updates `weekly_rewards`/`daily_rewards` statuses and adjusts totals.
  - Confirmation endpoint sets on‑chain timestamp: `pages/api/rewards/confirm.ts:1`
- Instant Claim (Boost): `pages/api/rewards/boost.ts:1`
  - Converts a 30% fee to FRY 2.0 (via Tinyman swaps when needed) and sends to `FRYALGO_WALLET`.
  - Updates rewards from `pending → claimable` at 70% and adjusts totals.


## Withdrawals

- Verification stake: `pages/api/stake/stake-withdraw.ts:1`
  - Available after 24h for `type=one` or 180 days for `type=two`, or immediately if the product stake asset changed since staking.
- Registration stake: `pages/api/stake/r-withdraw.ts:1`
- Node operation stake: `pages/api/stake/n-withdraw.ts:1`


## Tokens (What earns/what stakes)

These are product-driven; the app reads `products` to decide tokens and staking amounts. Built‑in ids for reference are in `lib/utils.ts:24`.

- Miners
  - Rewards: typically FRY 1.0
  - Verification staking: FRY 1.0 (legacy modal) or `products.reward.tokens.stake`

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

Bug reporting
- `DISCORD_BUG_WEBHOOK_URL` — Discord webhook that receives submitted bug reports (required to enable the UI button)
- `BUG_REPORT_RATE_LIMIT_HOURS` — optional override for the submission cooldown window (defaults to 12 hours if unset)

Hardware DB (optional)
- `MONGO_CREDS_DB`, `MONGO_CREDS_COLLECTION`


## Key UI Entry Points

- Devices: `pages/devices.tsx:1` (overview, actions, staking/boost/claim modals)
- My registrations (legacy staking path): `pages/my_registrations.tsx:1`
- Registration wizard: `pages/register.tsx:1` and `pages/pay-register.tsx:1`
- Hardware portal: `pages/nodeportal.tsx:1`
- Sign in: `pages/signin.tsx:1`


## Security Notes

- All server routes check `session.user.address` against request `address`.
- Reward wallet must be opted‑in to the reward ASA; the UI enforces this with server‑side balance checks.


## Local Development

1) Setup `.env` with Mongo URI, NextAuth secret, and required mnemonics.
2) `npm install`
3) `npm run dev`
4) Sign in at `/signin`; connect a supported Algorand wallet.
