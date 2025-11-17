# Fry Dashboard Security Hardening Plan

This plan captures the remediation work required to restore rewards access while keeping the new anti-automation layers intact. Each item lists the intent, owner considerations, implementation steps, and validation notes.

## 1. Persist Device Fingerprints End-to-End
- **Intent:** Ensure Layer 4 (device fingerprint) blocks scripts but does not deny legitimate browser sessions.
- **Steps:**
  1. Extend `WalletAuthProvider` to return any stored `last_device_fingerprint`/`last_user_agent` so the NextAuth JWT gets seeded on login.
  2. Update NextAuth callbacks in `pages/api/auth/[...nextauth].ts`:
     - Store `deviceFingerprint` and `userAgent` inside the JWT on login.
     - Handle `trigger === 'update'` so later updates (e.g., capture endpoint) refresh the JWT.
     - Expose these values on the session object for API routes.
  3. Enhance `/api/auth/capture-fingerprint` to:
     - Persist `last_device_fingerprint` and `last_user_agent` in MongoDB.
     - Call `unstable_updateSession` so the active JWT immediately includes the new fingerprint/user-agent pair.
     - Return a success payload that the UI can use to confirm readiness.
  4. Adjust `verifyDeviceFingerprintMiddleware` logging to expect the new session fields. (Core comparison logic can remain unchanged once session is hydrated.)
- **Validation:** Manual curl with/without the fingerprint to confirm 403 on mismatch, 200 when matching. Verify aggregated logging still records events.

## 2. Capture Fingerprint in the Browser Before Protected Calls
- **Intent:** Prevent protected SWR/fetch hooks from firing before the fingerprint handshake completes (which currently causes 403s).
- **Steps:**
  1. In `_app.tsx`, add a client-side effect (inside `ProtectedComponent`) that:
     - Waits for a valid session.
     - If `session.deviceFingerprint` is absent, POSTs to `/api/auth/capture-fingerprint`.
     - Blocks rendering protected pages (or marks a local `fingerprintReady` flag) until capture succeeds.
  2. Guard reward fetch hooks (`useRewardSummary`, `/devices` totals loader, history pagination) behind the same readiness flag to avoid redundant 403 retries.
- **Validation:** Sign in with a wallet and confirm the first dashboard render succeeds without 403s. Inspect network tab to ensure capture runs once per browser/device.

## 3. Harden Security Telemetry & Controls
- **Intent:** Maintain observability and safe rollback options while the layers stay active.
- **Steps:**
  1. Ensure capture endpoint logs an aggregated success event for analytics (optional but recommended).
  2. Document and ship an env toggle (`DISABLE_DEVICE_FINGERPRINT=true|1|yes`) that bypasses Layer 4 for emergency access, with clear rollback guidance.
  3. Extend automated scripts (`scripts/test-reward-security*.ts`) with a “happy path” flow that now includes the fingerprint capture call before exercising APIs.
- **Validation:** Run existing security test scripts and confirm they pass once updated; monitor MongoDB aggregation entries for both successes and failures.

## 4. Regression Test Coverage
- **Intent:** Prevent future overblocking.
- **Steps:**
  1. Add an integration test (Playwright or browser automation) that signs in, triggers fingerprint capture, and fetches totals/summary/page/records/claim to confirm non-403 responses.
  2. Update documentation (`docs/SECURITY_MONITORING*.md`) with the new handshake and troubleshooting steps.
- **Validation:** Ensure CI (or local test runs) fail if the fingerprint handshake regresses.

## Execution Order
1. Implement Sections 1 and 2 (critical path to restore functionality).
2. Follow with Section 3 telemetry updates.
3. Finish with Section 4 testing/documentation.

## Owner Notes
- Coordinate with DevOps to set `REQUEST_SIGNATURE_SECRET`/`TOKEN_GENERATION_SECRET` in prod and ensure rotation procedures are documented.
- Communicate to support staff that users may need to re-login once after deployment to bind their device fingerprint.
