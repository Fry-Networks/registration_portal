# Final Dependency & Wallet Plan
*Updated: November 12th 2025*

This single file replaces **all** prior dependency/wallet plans in `docs/wallets_and_dependencies/` (assessment, reliability plan, dependency audits, modernization plan, master audit). Anything done elsewhere is captured here as ✅, and every remaining task from those documents now lives in the open checklists below.

## Purpose & Scope
- Track the security/dependency posture for the user dashboard (Next.js pages router + Algorand wallet stack).
- Serve as the authoritative backlog for wallet infra, dependency hygiene, observability, and operational runbooks.
- Provide enough detail (file refs, acceptance criteria) so work can be scheduled without re-reading retired docs.

## Current State Snapshot
- **Runtime**: Next.js 15, React 18.2, MongoDB 6, Mongoose 8, Algorand custody via `lib/wallet/*`, Tinyman swaps.
- **Security Layers**: Client token HMAC + signed body + device fingerprint enforced on sensitive APIs; `withDeviceActionLock` + Mongo-backed request locks wrap staking/claim/boost/withdraw; rate limiter + Discord alerts front-run those routes.
- **Observability**: Wallet health + transaction monitors emit Discord alerts for claim/boost flows; journaled device actions provide a 90-day audit trail.
- **Risk Surface**: Framework/library drift (React 19 / Next 16 not adopted), lingering wallet/Algorand dependency upgrades, unused packages still in `package.json`, WalletConnect v1 `ws` advisory with no upstream patch, limited test/runbook coverage, incomplete analytics dashboards.

## ✅ Completed Initiatives (authoritative list)
### Wallet Infrastructure & API Safety
- [✅] **Wallet API security layers** — Staking/withdraw/fee endpoints now require client token + request signature + fingerprint checks via `lib/api/enforceWalletSecurity.ts`, and client requests attach headers through `lib/api/secureFetch.ts`.
- [✅] **Staking/withdraw monitoring coverage** — `monitorWalletHealth` now runs for registration/node/verification/withdraw + fee flows, and custodial withdrawals trigger `monitorTransaction` telemetry.
- [✅] **Legacy verification endpoints removed** — `/api/verify-stake`, `/api/stake/verify-node`, `/api/stake-withdraw`, and `/api/stake-available` are retired; UI callers all use `/api/stake/verification` + `/api/stake/withdrawable`.
- [✅] **Opt-in guardrails** — Server APIs fail fast with `WALLET_ASSET_NOT_OPTED_IN` (via `lib/algorand/optIn.ts`) and staking UI auto-prompts wallet opt-ins so users no longer discover the issue after submitting transactions.
- [✅] **Retired legacy `/api/algorand/send-txn` helper** — Registration/node staking now use the shared Stake modal (per-device actions in `components/DeviceListItem.tsx`) backed by `useWalletActions`; the legacy helper endpoint is fully removed.
- [✅] **Mongo-backed wallet request coordination** — `lib/wallet/requestCoordinator.ts`, `.client.ts`, and `lib/wallet/useWalletActions.ts` orchestrate global wallet locks; `device_transactions` journal stores idempotency metadata (per `wallet-and-dependencies-assessment`, now landed).
- [✅] **`withDeviceActionLock` adoption** — All staking/claim/boost/withdraw APIs run through `lib/api/deviceAction.ts` so Mongo request locks + TTL indexes guard miner actions (`wallet-reliability-plan` §0, §3).
- [✅] **Operation-level rate limiting** — `lib/api/operationRateLimit.ts` throttles by wallet + IP and alerts Discord prior to acquiring the action lock (`MASTER_SECURITY_AUDIT.md` §2).
- [✅] **Custodial broadcast finality** — `lib/wallet/signing.ts` + `lib/wallet/transactionConfirmation.ts` now wait ≥4 rounds before acknowledging Algorand custody flows (claim/boost/withdraw) as described in `MASTER_SECURITY_AUDIT.md`.
- [✅] **Legacy FRY 1.0 handling** — `scripts/unlock-legacy-verification.ts`, `/api/stake/stake-withdraw`, UI modals, and `lib/legacyStake.ts` handle unlock flags + bypass logic (per `AGENTS.md`/`README.md` November notes).

### Client Security & UX
- [✅] **Client token + signature enforcement** — `lib/clientToken.ts`, `lib/deviceFingerprint.ts`, `lib/api/fetchWithFingerprintRetry.ts`, and middleware enforce signed bodies, fresh tokens, and fingerprint validation (per `MASTER_SECURITY_AUDIT.md` §1).
- [✅] **UseSmartRetry adoption** — Wallet prompts for verification staking, registration staking, fee payment, and FRY conversion reuse `useSmartRetry` for controlled retries (`MASTER_SECURITY_AUDIT.md` §5).
- [✅] **Wallet branding + metadata** — `lib/wallet/manager.ts` ensures Fry Networks identity propagates to Pera/Defly connectors (documented in `wallet-reliability-plan` §0).

### Observability & Alerting
- [✅] **Wallet health / transaction monitors (initial scope)** — `lib/monitoring/walletHealth.ts` + `lib/monitoring/transactionMonitor.ts` run for claim/boost flows and push Discord metrics (`MASTER_SECURITY_AUDIT.md` §2).
- [✅] **Boost idempotency + analytics hooks** — `/api/rewards/boost` now participates in `withDeviceActionLock`, logs journal metadata, and feeds monitoring (`MASTER_SECURITY_AUDIT.md` §2).
- [✅] **Security event aggregation** — `lib/securityEventAggregation.ts` + associated Mongo collections bucket auth bypass attempts and alert operations (per `AGENTS.md`/`MASTER_SECURITY_AUDIT.md`).

### Dependency Baseline
- [✅] **Missing dependencies fixed** — `@mapbox/search-js-core` and `chalk` installed; package versions reconciled with actual usage (`DEPENDENCY_AUDIT_FINAL.md`).
- [✅] **Critical infra upgrades** — MongoDB, Mongoose, Next.js 15, and `@auth/mongodb-adapter` bumped to the versions noted in `MASTER_SECURITY_AUDIT.md`.
- [✅] **Cookie advisory mitigation** — `resolutions.cookie = 0.7.2` + preinstall `npm-force-resolutions` keep authentication stack patched (`dependency-modernization-plan.md`).

### Documentation & Processes
- [✅] **Legacy docs archived** — This file supersedes: `wallet-and-dependencies-assessment.md`, `wallet-reliability-plan.md`, `DEPENDENCY_AUDIT_REPORT.md`, `DEPENDENCY_AUDIT_FINAL.md`, `dependency-modernization-plan.md`, `WALLET_AND_DEPENDENCIES_AUDIT.md`, and `MASTER_SECURITY_AUDIT.md`.
- [✅] **Device action runbooks (initial)** — Internal guidance exists for unlocking stuck requests via `forceReleaseLocksForAddress()` (from `wallet-and-dependencies-assessment.md`), though richer tooling is still pending (see backlog).

---

## 🔄 Outstanding Initiatives (imported from all legacy docs)
Each bullet below is either explicitly called out in the retired docs or implied follow-up work. When complete, mark with ✅ and cite the PR / files touched.

### 1. Wallet & Custodial Hardening
- [ ] **Unify wallet request coordination across client/server** — `lib/wallet/requestCoordinator.client.ts` still uses a session-local Map; update it (or add an API bridge) so wallet prompts respect the Mongo-backed locks described in `lib/wallet/requestCoordinator.ts` (current behavior only prevents double-clicks per tab).
- [ ] **Document + QA supported wallet versions/branding** — After dependency upgrades, capture version matrix (Pera, Defly, WalletConnect) and re-verify brand assets show Fry icon/URL (`wallet-reliability-plan` §3).
- [ ] **Action queue coverage for legacy/edge flows** — Apply the single-flight pattern to boost history actions, my_registrations legacy flows, and any remaining pages not wired to `useSmartRetry` (`wallet-reliability-plan` §3.1).
- [ ] **Lock/journal tooling & runbook** — Build scripts or UI for inspecting `device_request_locks` and `device_transactions`, plus documented recovery procedures for support (mentioned across `wallet-reliability-plan` and `dependency-modernization-plan`).
- [ ] **Automated tests for locks + retry behavior** — Add node:test/Jest coverage for lock acquisition, TTL expiry, forced releases, `withDeviceActionLock` journal writes, and `useSmartRetry` state machine (`wallet-reliability-plan` Outstanding, `wallet-and-dependencies-assessment.md` Phase 5).
- [ ] **Wallet-level throttling after upgrades** — Re-evaluate rate limiting once wallet libraries update; add soak tests (desktop/mobile) to ensure new connectors respect locks/queues (`wallet-reliability-plan` Outstanding).
- [ ] **Persist rate-limit counters** — `lib/api/operationRateLimit.ts` stores buckets in-memory; migrate to Mongo/Redis so restart/scale events don’t reset throttles (finding from current repo review).
- [ ] **Add waitRounds>=4 to every custodial broadcast** — Reward claim (`pages/api/rewards/claim.ts`), boost (`pages/api/rewards/boost.ts`), and FRY conversion payouts (`pages/api/conversion/transfer_reward.ts`) still call `signAndSubmitCustodialTransactions` without `waitRounds`, so they return before on-chain finality.
- [ ] **Boost analytics dashboards** — Use `device_transactions` and `reward-boosts` to chart boost counts, fee totals, asset mix; expose via ops dashboard or Discord summary (`MASTER_SECURITY_AUDIT.md` §5).

### 2. Dependency & Framework Modernization
#### 2.1 Core Upgrades
- [ ] **React & React DOM → 19.x** — Validate concurrent features, Suspense boundaries, and third-party components (`dependency-modernization-plan.md` Phase 2, `DEPENDENCY_AUDIT_REPORT.md`).
- [ ] **Next.js → 16.x** — Review breaking changes (app router interop, middleware, turbopack defaults); audit `pages/` + `app/` usage (`wallet-and-dependencies-assessment.md` Next.js migration sections).
- [ ] **NextAuth → v5** — Migrate callbacks/session helpers; retest Algorand credential provider (multiple docs highlight this).
- [ ] **TypeScript & @types** — Align with latest Node 20.x definitions as recommended in `dependency-modernization-plan.md`.

#### 2.2 Wallet & Algorand Libraries
- [ ] **Upgrade Algorand stack** — `algosdk`, `@txnlab/use-wallet(-react)`, `@perawallet/connect`, `@blockshake/defly-connect`, `@tinymanorg/tinyman-js-sdk`; retest Tinyman swaps + staking flows (`wallet-reliability-plan` §6, dependency docs).
- [ ] **Monitor WalletConnect replacements** — Track TxnLab’s migration path to Reown/AppKit so `@walletconnect/modal` deprecation and `ws` vulnerability are resolved (`MASTER_SECURITY_AUDIT.md`, `DEPENDENCY_AUDIT_FINAL.md`).
- [ ] **Replace `react-mapbox-autocomplete` + other vulnerable libs** — Documented in `dependency-modernization-plan.md` (unfixable `node-fetch`/`fbjs` chain).

#### 2.3 UI & Utility Packages
- [ ] **Tailwind 3 → 4 + plugin updates** — Update Tailwind config, PostCSS pipeline, and dependent components (`DEPENDENCY_AUDIT_REPORT.md`).
- [ ] **Component/library refreshes** — `@tremor/react`, `primereact`, `@headlessui/react`, `framer-motion`, `react-hook-form`, `react-modal`, `@heroicons/react`, `@remixicon/react`, `axios`, `swr`, `mapbox-gl`, `dotenv` (listed in `MASTER_SECURITY_AUDIT.md` §4, `DEPENDENCY_AUDIT_FINAL.md`).
- [ ] **Remove legacy/unused packages** — Chakra, Emotion, DaisyUI, Styled Components, React Router, React Query, Moment, Zustand, Socket.IO, Planetscale/Kysely, Typewriter, Web Vitals, XMLHTTPRequest, etc. Remove in batches with `npm run build` + smoke tests each time (per both dependency audit docs).
- [ ] **Bundle & performance check** — Measure bundle size before/after removals; target 15–20% reduction (from `dependency-modernization-plan.md` Phase 4).

#### 2.4 Process & Tooling
- [ ] **Automated dependency monitoring** — Add scripts/CI steps (`npm run deps-check`, `npm audit --audit-level=moderate`) as outlined in `dependency-modernization-plan.md`.
- [ ] **Security scanning in CI** — Ensure `npm audit`, Snyk (if available), and ESLint/TypeScript gates run on PRs (`dependency-modernization-plan.md`).
- [ ] **Document dependency update procedures** — Version pinning strategy, testing checklist, rollback steps (Phase 6 of modernization plan).

### 3. Client UX & Validation Enhancements
- [ ] **Extend pre-flight validation** — Broaden sanity checks (token opt-in, stake availability, credential completeness) before wallet prompts on every flow (`wallet-and-dependencies-assessment.md` Phase 3.2).
- [ ] **Contextual guidance for retries/cancellations** — Ensure modals show actionable guidance when users cancel or encounter provider errors (`wallet-and-dependencies-assessment.md` Phase 3.1).
- [ ] **Mobile latency handling** — Tune retry timers + fingerprint refresh windows for mobile browsers to prevent signature mismatch loops (`wallet-reliability-plan` §1).
- [ ] **Legacy UI alignment** — Update `pages/my_registrations.tsx` and legacy modals to use new locking + retry UX (called out in multiple docs).

### 4. Observability, Metrics & Alerting
- [ ] **Real-time transaction dashboards** — Stream wallet operation metrics (success/failure, confirmation latency, fee stats) to Grafana/Looker or enriched Discord embeds (`wallet-and-dependencies-assessment.md` Phase 2.1).
- [ ] **Wallet provider health metrics** — Track provider-specific errors/timeouts to catch provider-side incidents early (`wallet-and-dependencies-assessment.md` Phase 2.2).
- [ ] **Structured logging upgrades** — Expand Winston transports to include correlation IDs, wallet address tags, and request phases for simpler triage (`dependency-modernization-plan.md` follow-up).
- [ ] **Consolidated boost analytics** — Already in backlog above; ensure results persist for ops review.

### 5. Testing, QA & Runbooks
- [ ] **Comprehensive wallet test suite** — Automated tests covering staking, claim, boost, withdrawals, Tinyman swaps, retry paths; incorporate mocked wallet connectors as recommended in `wallet-and-dependencies-assessment.md` Phase 5.1.
- [ ] **Performance/soak testing** — Simulate concurrent wallet actions (desktop/mobile) after dependency upgrades to validate locks + rate-limits (`wallet-reliability-plan` Outstanding).
- [ ] **Support tooling** — CLI or admin UI for viewing lock/journal state, forcing releases, and inspecting security events (`wallet-reliability-plan`, `dependency-modernization-plan.md`).
- [ ] **Operational metrics & SLOs** — Define SLA/SLO targets (success rate, mean confirmation time) and alert thresholds (from `wallet-and-dependencies-assessment.md` metrics section).
- [ ] **Runbook updates** — Document fingerprint/token troubleshooting, wallet mismatch handling, and dependency rollback procedures (Phase 6 of modernization plan).

### 6. Open Security Items
- [ ] **WalletConnect v1 `ws` vulnerability** — Continue tracking upstream; document compensating controls (rate limiting, WAF) until patched (`MASTER_SECURITY_AUDIT.md` §3).
- [ ] **Node-fetch/fbjs chain** — Remove `react-mapbox-autocomplete` or isolate it behind safer alternative as per `dependency-modernization-plan.md`.
- [ ] **Legacy cookie dependency** — Keep monitoring `@auth/*` releases so the `resolutions.cookie` override can be removed once upstream patches land.

---

## Phased Roadmap (derived from historical plans)
| Phase | Focus | Key Items |
| --- | --- | --- |
| **Week 1 – Critical Security** | Custodial cleanup + wallet upgrades | ~~Remove `/api/algorand/send-txn`~~ (done), extend monitors, plan wallet dependency bumps, enforce CI audits. |
| **Week 2 – Monitoring & UX** | Observability + retry/pre-flight polish | Real-time dashboards, wallet health metrics, action queue coverage, contextual guidance updates. |
| **Week 3 – Framework Upgrades** | React/Next/NextAuth modernization | Execute core upgrades, resolve breaking changes, retest wallet flows, document version matrices. |
| **Week 4 – Dependency Cleanup** | Remove unused libraries + Tailwind 4 | Batch uninstall legacy packages, update UI libs, measure bundle impact, rerun `npm run build` each batch. |
| **Week 5 – Testing & Runbooks** | Automated tests + support tooling | Implement wallet test harnesses, soak tests, lock/journal CLI, finalize runbooks and metrics. |
| **Ongoing** | Vulnerability watch + CI automation | `npm audit --audit-level=moderate`, dependency monitoring scripts, WalletConnect/`ws` advisory tracking. |

---

## Next Actions
1. **Validate this plan against the live codebase** (full repo review) to confirm every “✅” truly landed and every open item still applies.
2. **Prioritize Week-1 items** (legacy endpoint removal, monitoring coverage, upgrade planning) and open tasks/issues for each.
3. **Adopt this file in place of all superseded docs**; future updates happen here only (add PR references when marking items ✅).

_Maintainers: Wallet & Security Engineering_  
_Latest review owner: (assign on adoption)_  
