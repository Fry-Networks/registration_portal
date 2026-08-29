# Security Regression Tests

Use this checklist whenever we ship changes that touch authentication, rewards APIs, or the new anti-automation layers.

## 1. Browser Happy Path
1. `npm run dev` (or point to staging).
2. Sign in with a wallet via `/signin`.
3. Verify `POST /api/auth/capture-fingerprint` runs automatically (Network tab → status 200).
4. Open `/devices` and `/history`; totals, summaries, and pagination should populate without `403 DEVICE_MISMATCH`.
5. Trigger a claim or boost flow (mock data is fine); success or business-rule errors (400/404/422) are acceptable, but **no 403 responses**.

## 2. Scripted Smoke (CI-friendly)
Run the authenticated script with a real session token:

```bash
SESSION_COOKIE="paste_next_auth_token" \
REQUEST_SIGNATURE_SECRET="your_request_signature_secret" \
node scripts/test-authenticated-session.mjs
```

Expected:
- Step 1 prints the wallet address.
- Step 2 logs `✓ Fingerprint bound (...)`.
- Tests 1–3 return non-403 statuses.
- Test 4 intentionally returns `403 MISSING_CLIENT_TOKEN`.

## 3. Negative Controls
- Call `/api/rewards/get-asset-totals` **without** headers → expect `403 MISSING_CLIENT_TOKEN`.
- Replay the same request with stale timestamp (`Date.now()/1000 - 400`) → expect `403 INVALID_SIGNATURE`.
- Use a different `User-Agent` after capture → expect `403 DEVICE_MISMATCH` and a `DEVICE_FINGERPRINT_MISMATCH` event in MongoDB `security-events`.

## 4. Emergency Bypass Verification
1. Set `DISABLE_DEVICE_FINGERPRINT=true` on the API process.
2. Repeat Section 2. All requests should pass Layer 4 while logging `DEVICE_FINGERPRINT_BYPASS` events.
3. Remove the env var and restart; capture step should be required again.

## 5. Future Automation (TODO)
- Add a Playwright smoke test that performs wallet sign-in (with mocked wallet), posts to `/api/auth/capture-fingerprint`, and exercises the reward APIs with real responses.
- Wire Section 2 into CI (fail build on any unexpected 403).
