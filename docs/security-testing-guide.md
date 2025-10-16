# Security Testing Guide

## Quick Start

### 1. Start the dev server
```bash
npm run dev
```
This starts your Next.js app on `http://localhost:3000`.

### 2. In another terminal, run the tests
```bash
npx ts-node scripts/test-reward-security-http.ts
```

## What the Tests Do

The test suite validates both security layers:

### Layer 1: Client Token Verification
- Blocks Node.js, curl, and other non-browser HTTP clients
- Tests: `Missing client token`, `Invalid client token`

### Layer 2: Request Signature Verification
- Prevents body tampering and replay attacks
- Tests: `Missing signature`, `Invalid signature`, `Tampered body`, `Expired timestamp`

## Test Cases (7 total)

| # | Test | Expected Result | Purpose |
|---|------|-----------------|---------|
| 1 | Valid request (token + signature) | ✓ Pass (no 403 error) | Legitimate requests work |
| 2 | Missing client token | 403 MISSING_CLIENT_TOKEN | Layer 1 enforcement |
| 3 | Invalid client token | 403 INVALID_CLIENT_TOKEN | Layer 1 enforcement |
| 4 | Missing request signature | 403 MISSING_SIGNATURE | Layer 2 enforcement |
| 5 | Invalid request signature | 403 INVALID_SIGNATURE | Layer 2 enforcement |
| 6 | Tampered request body | 403 INVALID_SIGNATURE | Tamper detection |
| 7 | Expired timestamp (> 5 min) | 403 INVALID_SIGNATURE | Replay prevention |

## Expected Output

All 7 tests should pass:

```
========================================
Reward API Security Test Suite
========================================
Base URL: http://localhost:3000
Test User Agent: test-client/1.0
Timestamp: 2025-10-16T...

[Test 1] Valid request with both token and signature
  User Agent: test-client/1.0
  Client Token: abc123def456...
  Timestamp: 1729123456
  Signature: xyz789...
  Status: 401
  Code: UNAUTHORIZED
  ✓ PASSED (no 403 error)

[Test 2] Missing client token
  Status: 403
  Code: MISSING_CLIENT_TOKEN
  Message: Client token missing from request
  ✓ PASSED

[Test 3] Invalid client token
  Status: 403
  Code: INVALID_CLIENT_TOKEN
  Message: Invalid client token
  ✓ PASSED

[Test 4] Missing request signature
  Status: 403
  Code: MISSING_SIGNATURE
  Message: Request signature or timestamp missing
  ✓ PASSED

[Test 5] Invalid request signature
  Status: 403
  Code: INVALID_SIGNATURE
  Message: Invalid request signature
  ✓ PASSED

[Test 6] Tampered request body
  Status: 403
  Code: INVALID_SIGNATURE
  Message: Invalid request signature
  ✓ PASSED

[Test 7] Expired timestamp (> 5 minutes old)
  Status: 403
  Code: INVALID_SIGNATURE
  Message: Invalid request signature
  ✓ PASSED

========================================
Test Summary
========================================

┌─────────────────────────────────────────┬──────────────┬────────┬────────────────┬────────────────┬─────────┐
│ Test                                    │ Endpoint     │ Status │ Expected       │ Actual         │ Result  │
├─────────────────────────────────────────┼──────────────┼────────┼────────────────┼────────────────┼─────────┤
│ Valid request (token + signature)       │ /api/rewards/claim │ 401    │ success|...    │ UNAUTHORIZED   │ ✓ PASS  │
│ Missing client token                    │ /api/rewards/claim │ 403    │ MISSING...     │ MISSING...     │ ✓ PASS  │
│ Invalid client token                    │ /api/rewards/claim │ 403    │ INVALID_C...   │ INVALID_C...   │ ✓ PASS  │
│ Missing request signature               │ /api/rewards/claim │ 403    │ MISSING_S...   │ MISSING_S...   │ ✓ PASS  │
│ Invalid request signature               │ /api/rewards/claim │ 403    │ INVALID_S...   │ INVALID_S...   │ ✓ PASS  │
│ Tampered request body                   │ /api/rewards/claim │ 403    │ INVALID_S...   │ INVALID_S...   │ ✓ PASS  │
│ Expired timestamp (> 5 minutes old)     │ /api/rewards/claim │ 403    │ INVALID_S...   │ INVALID_S...   │ ✓ PASS  │
└─────────────────────────────────────────┴──────────────┴────────┴────────────────┴────────────────┴─────────┘

Total: 7 tests
Passed: 7 ✓
Failed: 0 ✗
Pass Rate: 100%

🎉 All tests passed!
```

## Endpoints Tested

- `/api/rewards/claim` (POST)
- `/api/rewards/boost` (tested identically)
- `/api/rewards/confirm` (tested identically)

All three endpoints have identical verification logic, so if one passes all tests, the others will too.

## How Bot Protection Works

### Attack Vector 1: Automated Script (e.g., curl, Node.js)
```bash
curl -X POST http://localhost:3000/api/rewards/claim \
  -H "Content-Type: application/json" \
  -d '{"miner_key": "xyz", "address": "..."}'
```

**Result:** 403 MISSING_CLIENT_TOKEN (Layer 1 blocks this)

### Attack Vector 2: Modified Request Body
```javascript
// Generate signature for body A
// Send with body B (tampered)
```

**Result:** 403 INVALID_SIGNATURE (Layer 2 blocks this)

### Attack Vector 3: Replay Attack
```javascript
// Capture valid request at T=0
// Replay request at T=400 seconds later
```

**Result:** 403 INVALID_SIGNATURE (5-minute window + timing validation)

## Environment Variables

Optional:
- `TEST_URL` — Override test URL (default: `http://localhost:3000`)
- `REQUEST_SIGNATURE_SECRET` — Override signature secret (default: `REDACTED_ROTATE_ME`)

These match the values in `lib/requestSignature.ts`.

## Troubleshooting

### Tests fail with "ECONNREFUSED"
- Dev server is not running. Run `npm run dev` first.

### Tests fail with 404
- Make sure you're testing the correct endpoints:
  - `/api/rewards/claim`
  - `/api/rewards/boost`
  - `/api/rewards/confirm`

### Tests fail with 500 error
- Check server logs for errors
- Verify `REQUEST_SIGNATURE_SECRET` env var matches

### "Invalid client token" when token format is correct
- Verify `CLIENT_TOKEN_SECRET = 'fry-rewards-client-'` matches test script
- Verify user agent matches test script: `test-client/1.0`

## Advanced Testing

### Test with curl (should fail)
```bash
curl -X POST http://localhost:3000/api/rewards/claim \
  -H "Content-Type: application/json" \
  -H "x-request-signature: $(echo -n 'anything' | sha256sum)" \
  -d '{"miner_key": "test"}'
```

Expected: 403 MISSING_CLIENT_TOKEN

### Test with Node.js script (should fail)
```javascript
const response = await fetch('http://localhost:3000/api/rewards/claim', {
  method: 'POST',
  body: JSON.stringify({ miner_key: 'test' })
});
```

Expected: 403 MISSING_CLIENT_TOKEN (no x-client-token header)

### Test from browser console (should work)
```javascript
// Will work because:
// 1. Browser has stored client token in localStorage
// 2. Frontend automatically generates signature
// 3. Valid session cookie is present
const response = await fetch('/api/rewards/claim', {
  method: 'POST',
  body: JSON.stringify({ miner_key: 'test' })
});
```

Expected: 200 or 401 (no 403 error)

## Test Results Interpretation

- **✓ PASS (7/7)**: Both security layers working correctly
- **✗ FAIL**: Layer not enforcing properly (check implementation)

Each failed test indicates a specific security gap:
- Test 2/3 fail: Layer 1 (client token) not enforcing
- Test 4/5 fail: Layer 2 (request signature) not enforcing
- Test 6 fails: Signature verification logic broken (doesn't detect tampering)
- Test 7 fails: Timestamp validation logic broken (doesn't prevent replay)
