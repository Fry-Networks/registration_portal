# WalletConnect v2 Migration Plan (Pera iOS Failures)

This document lays out a **security‑first, no‑guessing** plan to migrate the Fry Dashboard wallet connection from **WalletConnect v1** (current Pera integration) to **WalletConnect v2** using the existing `@txnlab/use-wallet` stack. It is based on an audit of this repo and its installed dependencies.

## Current State (Verified)

**Wallet stack in use**
- `@txnlab/use-wallet` + `@txnlab/use-wallet-react`
- Pera connector: `PeraWalletConnectOptions` in `lib/wallet/manager.ts`
- Sign‑in flow uses Pera/Defly wallets via `use-wallet` (`components/Navbar.tsx`, `components/SignIn.tsx`, `pages/signin.tsx`)

**Evidence of WalletConnect v1**
- Pera uses `@perawallet/connect` inside `@txnlab/use-wallet` (WCv1), and exposes `PeraWalletConnectOptions` with `bridge` (WCv1 pattern).
- Active sessions in Pera display **WCV1**.

**WalletConnect v2 capability already present**
- `@txnlab/use-wallet` (4.4.0 installed) includes a **WalletConnect v2** connector (`WalletConnect`) that relies on:
  - `@walletconnect/sign-client`
  - `@walletconnect/modal`
- These packages are already in `package.json` and `package-lock.json`.

**Source locations**
- Wallet config: `lib/wallet/manager.ts`
- Wallet connect UI: `components/Navbar.tsx`, `components/SignIn.tsx`, `pages/signin.tsx`, `components/connect.tsx`
- Pera in‑app browser block: `components/PeraInAppBrowserBlocker.tsx`

## Why This Migration

Pera iOS failures with `"Requested account cannot be connected"` are strongly associated with WalletConnect v1 deep‑link brittleness on iOS. WalletConnect v2 uses a different session model and has better iOS behavior, especially when the browser and wallet app negotiate via the WCv2 relay.

## Security Principles

- **No weakening** of wallet security or signing gates.
- WCv2 must use a **projectId** and relay over `wss://relay.walletconnect.com` (or a vetted relay).
- Preserve existing client‑side request signature + device fingerprint checks.

## Migration Strategy (Phased)

### Phase 0 — Baseline & Telemetry (No functional change)
1) Confirm current failure paths using new client telemetry (already added in `components/Navbar.tsx`).
2) Capture iOS error data for Pera connect in `/api/logging/client-error`.

Outcome: confirm error source before cutover.

### Phase 1 — Introduce WalletConnect v2 Connector (Parallel)
**Goal:** add WCv2 without removing Pera v1 immediately.

1) **Add WalletConnect v2 wallet entry** in `lib/wallet/manager.ts`:
   - Use `WalletId.WALLETCONNECT` with `WalletConnectOptions`.
   - Provide:
     - `projectId` (new secret: `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`).
     - `relayUrl` (default `wss://relay.walletconnect.com`).
     - `metadata` (app name/icon/url).
     - `themeMode`/`themeVariables` for WC modal if desired.
   - Keep Pera/Defly existing entries for now.

2) **Add a Pera‑skinned WCv2 entry**:
   - `@txnlab/use-wallet` supports custom WC skins.
   - There is **no built‑in Pera skin**, so create a custom skin using the existing Pera icon URL.

3) **Expose WCv2 in UI** (without removing existing Pera option):
   - Add a new wallet option label (e.g., “Pera (WalletConnect v2)”).
   - Default iOS to WCv2 option (device check).

4) **Telemeter usage**:
   - Log which wallet entry is selected (WCv1 vs WCv2).

Exit criteria:
- WCv2 connects successfully on iOS and desktop for at least one test account.

### Phase 2 — Cutover
1) Make WCv2 the **default** for Pera (or replace Pera option in UI entirely).
2) Keep WCv1 only as a fallback (if needed).
3) Monitor connection errors for WCv1 vs WCv2 usage.

### Phase 3 — Cleanup
1) Remove WCv1 Pera connector if no longer needed.
2) Optionally remove `@perawallet/connect` from dependencies if unused.

## Files to Modify

**Core wallet config**
- `lib/wallet/manager.ts`  
  - Add WCv2 wallet entry with `WalletConnectOptions`.
  - Optionally keep Pera WCv1 and Defly, or move Defly to WCv2 if desired.

**Wallet UI / connect flows**
- `components/Navbar.tsx`  
  - Show WCv2 entry (and optionally hide WCv1 on iOS).
  - Ensure error telemetry includes wallet id and user agent (already patched).
- `components/SignIn.tsx`, `pages/signin.tsx`, `components/connect.tsx`  
  - Ensure they handle the new wallet id and do not assume `wallet.id === 'pera'`.

**Pera in‑app browser block**
- `components/PeraInAppBrowserBlocker.tsx`  
  - Keep blocking Pera in‑app browser unless confirmed compatible with WCv2.

**Config / env**
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` (new)
- Optional: `NEXT_PUBLIC_WALLETCONNECT_RELAY_URL`

## Packages / Versions

Already present (verified in `package-lock.json`):
- `@txnlab/use-wallet` 4.4.0
- `@txnlab/use-wallet-react` 4.4.0
- `@walletconnect/sign-client` 2.23.4
- `@walletconnect/modal` 2.7.0

Potential upgrades (only if needed after validation):
- Update `@txnlab/use-wallet` if WCv2 fixes are required.
- Remove `@perawallet/connect` after WCv1 removal.

## Testing Plan

1) **Desktop**
   - WCv2 connect with Pera and Defly.
   - Sign‑in flow to NextAuth completes.

2) **iOS (Safari + Chrome)**
   - WCv2 connect success.
   - Pera app handles session request without “Requested account cannot be connected.”

3) **Regression**
   - Staking, claim, boost flows still sign transactions correctly.
   - Session fingerprint still binds and remains enforced.

## Rollback Plan

If WCv2 fails:
- Keep WCv1 entries active.
- Add UI flag to force WCv1 selection on all platforms.
- Revert wallet list to Pera/Defly WCv1 only.

## Notes

- This migration does **not** affect Mongo, NextAuth, or server‑side security checks.
- It strictly changes the wallet transport layer used by the client.
