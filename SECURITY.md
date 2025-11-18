# Wallet Flow Security Notes

This dashboard relies on Algorand wallets (Pera, Defly) via WalletConnect v2. To keep the attack surface minimal:

## Client Responsibilities

- All wallet operations run through `lib/wallet/*`. Components never instantiate Algod clients or touch raw WalletConnect APIs directly.
- `useWalletActions` serializes signing requests to avoid concurrent prompts and enforces a fresh signature on every retry.
- Unsigned transactions are built with the shared builders (`buildPaymentTxn`, `buildAssetTransferTxn`), ensuring consistent fee handling and replay-resistant notes.
- No secrets, mnemonics, or mnemonics-derived keys are persisted in the browser. Session storage only contains wallet metadata from `@txnlab/use-wallet`.
- Network calls run through `fetchWithFingerprintRetry` to protect against replay and session fixation.

## Server/API Responsibilities

- Requests carry short-lived nonces signed via wallet before authentication is granted (`pages/signin.tsx` + `lib/auth.ts`).
- Stake/claim APIs verify wallet/session alignment and operate on idempotent, locked documents (see `docs/wallet-reliability-plan.md` for roadmap).
- Reward claims pay network fees from the wallet after explicit confirmation; server-side mnemonics never leak to the client.

## Operational Guidance

- Clear WalletConnect sessions on logout (`disconnectAllWallets`) and when wallet/session mismatch is detected.
- Treat transaction journals and request locks as sensitive metadata. They log addresses and error codes but never private keys.
- Always run `npm test` (Node test suite) after touching wallet logic; the suite covers transaction builders and API helpers.

## Dependencies

- Wallet interactions rely on the maintained `@txnlab/use-wallet` + WalletConnect v2 stack; no legacy WCV1 adapters remain.
- Algorand SDK usage is encapsulated in `lib/wallet/transactions.ts` and server helpers, simplifying upstream upgrades.
