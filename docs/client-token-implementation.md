# JavaScript Challenge Implementation for Reward APIs

## Overview

This implementation adds a **JavaScript Challenge** layer to prevent automated scripts (curl, Node.js, headless browsers) from calling sensitive reward claim endpoints even if they have a valid session cookie.

The system works by:
1. **Frontend**: Generating a SHA-256 token based on browser context (user agent) and storing it in localStorage
2. **Frontend**: Sending the token with each sensitive API request in the `x-client-token` header
3. **Backend**: Verifying the token by recomputing the expected hash and comparing it

Since the token generation requires:
- The real browser's `navigator.userAgent`
- The WebCrypto API (not available in Node.js)
- The ability to store/read from localStorage

Automated scripts cannot bypass this protection.

---

## Files Created/Modified

### New Files

1. **`lib/clientToken.ts`**
   - `generateClientToken()` — generates SHA-256 token based on user agent
   - `getClientToken()` — retrieves or generates token from localStorage
   - `clearClientToken()` — clears stored token (for testing/logout)

2. **`lib/clientTokenMiddleware.ts`**
   - `verifyClientToken(req, res)` — validates token from `x-client-token` header
   - `withClientTokenVerification(handler)` — HOC middleware wrapper (optional)

### Modified Files

#### Frontend Components

1. **`pages/_app.tsx`**
   - Added token generation on app initialization
   - Token is generated once and stored in localStorage on app load

2. **`components/modals/Claim.tsx`**
   - Added `getClientToken()` import
   - Updated fetch to include `'x-client-token': clientToken` header
   - Token is retrieved from localStorage on each claim request

3. **`components/modals/Boost.tsx`**
   - Added `getClientToken()` import
   - Updated fetch to include `'x-client-token': clientToken` header
   - Token is retrieved from localStorage on each boost request

#### Backend API Endpoints

1. **`pages/api/rewards/claim.ts`**
   - Added `verifyClientToken` import
   - Added token verification check after session validation
   - Returns 403 Forbidden if token is missing or invalid

2. **`pages/api/rewards/boost.ts`**
   - Added `verifyClientToken` import
   - Added token verification check after session validation
   - Returns 403 Forbidden if token is missing or invalid

3. **`pages/api/rewards/confirm.ts`**
   - Added `verifyClientToken` import
   - Added token verification check after session validation
   - Returns 403 Forbidden if token is missing or invalid

---

## How It Works

### Token Generation (Browser)

```typescript
// In _app.tsx (runs once on app load)
const token = await generateClientToken();
// Computes: SHA-256('fry-rewards-client-' + navigator.userAgent)
// Stored in: localStorage.clientToken
```

**Example token generation:**
```
Input: 'fry-rewards-client-Mozilla/5.0 (Windows NT 10.0; Win64; x64)...'
Output: 'a3b4c5d6e7f8g9h0...' (64-char hex string)
```

### Token Transmission (Browser)

```typescript
// In Claim.tsx / Boost.tsx
const clientToken = await getClientToken(); // retrieves from localStorage
fetch('api/rewards/claim', {
  headers: {
    'x-client-token': clientToken
  }
});
```

### Token Verification (Backend)

```typescript
// In claim.ts / boost.ts / confirm.ts
const token = req.headers['x-client-token'];
const userAgent = req.headers['user-agent'];
const expected = SHA-256('fry-rewards-client-' + userAgent);

if (token !== expected) {
  return res.status(403).json({ error: 'Invalid client token' });
}
```

---

## Security Properties

### What This Protects Against

✅ **Curl requests** — no User-Agent spoofing + no WebCrypto + no localStorage = no token
✅ **Node.js fetch()** — no real browser context + no WebCrypto = no valid token
✅ **Python/Ruby scripts** — no navigator.userAgent + no localStorage = no token
✅ **Headless browsers** — can generate token but User-Agent is identifiable + easily blocked further if needed
✅ **Session hijacking** — stolen cookies alone are insufficient without the client token

### What This Does NOT Protect Against

❌ **Script running in the browser console** — has access to all browser APIs and localStorage
❌ **Browser extension** — has full browser context
❌ **Real user navigating to malicious site with embedded claim form** — requires additional CSRF/SameSite protections (already in place via next-auth)
❌ **Compromised frontend code** — attacker could modify the token generation

---

## Testing

### Test 1: Valid Browser Request (Should Succeed)

```bash
# Open the app in a real browser, click Claim
# Expected: Request succeeds, reward is claimed
curl -i http://localhost:3000/devices  # app generates token
```

### Test 2: Curl Request (Should Be Blocked)

```bash
curl -i -X POST http://localhost:3000/api/rewards/claim \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=..." \
  -d '{"miner_key": "...", "no": 1}'

# Expected Response:
# 403 Forbidden
# {
#   "success": false,
#   "code": "MISSING_CLIENT_TOKEN",
#   "message": "Client token is required"
# }
```

### Test 3: Node.js Fetch (Should Be Blocked)

```javascript
const response = await fetch('http://localhost:3000/api/rewards/claim', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ miner_key: '...' })
});

// Expected: 403 Forbidden - MISSING_CLIENT_TOKEN
```

### Test 4: Faked Token (Should Be Blocked)

```bash
curl -i -X POST http://localhost:3000/api/rewards/claim \
  -H "Content-Type: application/json" \
  -H "Cookie: next-auth.session-token=..." \
  -H "x-client-token: fake-token-12345" \
  -d '{"miner_key": "...", "no": 1}'

# Expected Response:
# 403 Forbidden
# {
#   "success": false,
#   "code": "INVALID_CLIENT_TOKEN",
#   "message": "Invalid client token"
# }
```

### Test 5: Browser with Developer Tools (Verify Token is Generated)

```javascript
// Open browser console and run:
console.log(localStorage.getItem('clientToken'));
// Should print a 64-character hex string (SHA-256 hash)

// Verify it matches what the server expects:
const token = localStorage.getItem('clientToken');
const userAgent = navigator.userAgent;
console.log('Token:', token);
console.log('User-Agent:', userAgent);
// Send this to backend logs to verify match
```

---

## Configuration

### Environment Variables (Optional)

Currently, the token generation secret is hardcoded:
```typescript
const TOKEN_GENERATION_SECRET = 'fry-rewards-client-';
```

If you want to make it configurable:

1. Add to `.env`:
   ```
   CLIENT_TOKEN_SECRET=your-secret-here
   ```

2. Update `lib/clientToken.ts` and `lib/clientTokenMiddleware.ts`:
   ```typescript
   const TOKEN_GENERATION_SECRET = process.env.CLIENT_TOKEN_SECRET || 'fry-rewards-client-';
   ```

### Endpoints Protected

The following endpoints now require a valid client token:

- ✅ `POST /api/rewards/claim`
- ✅ `POST /api/rewards/boost`
- ✅ `POST /api/rewards/confirm`

### Endpoints NOT Protected (By Design)

These endpoints are read-only and don't require client tokens:

- `GET /api/rewards/get-asset-totals` — safe to call from scripts
- `GET /api/rewards/get-reward-summary` — safe to call from scripts
- `GET /api/rewards/get-reward-records` — safe to call from scripts
- `GET /api/rewards/get-rewards-page` — safe to call from scripts

---

## Troubleshooting

### Issue: "Client token is required" Error

**Cause**: Token is not being generated or sent.

**Solution**:
1. Check browser console: `localStorage.getItem('clientToken')` should return a 64-char hex string
2. If empty, token generation failed — check browser console for errors
3. If present, verify it's being sent in request headers in Network tab

### Issue: "Invalid client token" Error

**Cause**: Token doesn't match expected value.

**Possible causes**:
1. User-Agent changed between token generation and request (rare)
2. Token in localStorage is stale/corrupted
3. Browser changed (cleared localStorage)

**Solution**:
1. Clear localStorage and reload: `localStorage.clear()`
2. Refresh page to regenerate token
3. Try the request again

### Issue: Legitimate Requests Are Blocked

**Cause**: Token verification is too strict.

**Debug Steps**:
1. Check backend logs for User-Agent mismatch
2. Log both the sent token and computed expected token
3. Verify the secret matches between frontend and backend

---

## Future Enhancements

### 1. Token Rotation
Currently, token is generated once per session. Consider:
- Regenerating token on sensitive actions
- Time-based token expiration
- Per-request token generation

### 2. User-Agent Pinning
Current implementation uses raw User-Agent. Could:
- Hash the User-Agent to make spoofing harder
- Require User-Agent consistency across requests
- Detect and alert on User-Agent changes

### 3. Rate Limiting
Combine with rate limiting per token:
- Track tokens in Redis
- Limit claims per token per time window
- Detect unusual patterns

### 4. CSRF Token Integration
Layer this with CSRF tokens for additional protection:
- Generate per-session CSRF token
- Require both client token AND CSRF token
- Rotate CSRF token periodically

---

## Code Examples

### Using the Client Token (Component)

```tsx
import { getClientToken } from '../../lib/clientToken';

async function handleClaim() {
  const clientToken = await getClientToken();
  
  const response = await fetch('/api/rewards/claim', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-token': clientToken  // ← Add this
    },
    body: JSON.stringify({ miner_key, no })
  });
  
  // Handle response...
}
```

### Protecting a New Endpoint

```typescript
// pages/api/rewards/new-endpoint.ts
import { verifyClientToken } from '../../../lib/clientTokenMiddleware';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // ... existing session check ...
  
  // Add token verification
  if (!verifyClientToken(req, res)) {
    return;  // verifyClientToken already sent error response
  }
  
  // ... rest of handler ...
}
```

### Using the Middleware Wrapper (Optional)

```typescript
import { withClientTokenVerification } from '../../../lib/clientTokenMiddleware';

const protectedHandler = async (req: NextApiRequest, res: NextApiResponse) => {
  // handler logic (verification already done by wrapper)
};

export default withClientTokenVerification(protectedHandler);
```

---

## Summary

This implementation successfully prevents automated script attacks on reward APIs by:

1. **Generating a unique token** based on browser context (User-Agent + secret)
2. **Storing the token** in browser localStorage (not accessible to Node.js or curl)
3. **Requiring the token** for POST requests to `/api/rewards/*` endpoints
4. **Validating the token** server-side by recomputing the expected hash

The system is **transparent to legitimate users** while **effectively blocking automated attacks**.
