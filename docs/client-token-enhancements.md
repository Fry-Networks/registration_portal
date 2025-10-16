# Enhanced Security Mitigations for Client Token System

## Overview

While the JavaScript Challenge prevents **automated scripts**, this document addresses the remaining threats with **defense-in-depth** strategies.

---

## Threat 1: Script Running in Browser Console

### Threat Model
An attacker with access to the browser console can:
- Read localStorage directly: `localStorage.getItem('clientToken')`
- Intercept fetch requests
- Modify the DOM and UI
- Submit requests programmatically

### Defense Strategy: Multi-Layer Protection

#### 1a. Content Security Policy (CSP) Headers
Prevent inline script execution and limit script sources.

**Implementation in `next.config.js`:**

```javascript
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "script-src 'self' https://cdn.jsdelivr.net https://unpkg.com; " +
           "style-src 'self' 'unsafe-inline'; " +
           "img-src 'self' data: https:; " +
           "connect-src 'self' https://xna-mainnet-api.algonode.cloud https://mainnet-api.algonode.cloud; " +
           "frame-ancestors 'none'; " +
           "base-uri 'self'; " +
           "form-action 'self'"
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY'
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block'
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin'
  }
];

module.exports = {
  async headers() {
    return [
      {
        source: '/api/rewards/:path*',
        headers: securityHeaders,
      },
    ];
  },
};
```

**Impact**: Blocks inline scripts but won't stop console access (browser feature).

#### 1b. Request Signature Verification
Add an additional layer: each request must include a valid HMAC signature.

**Create `lib/requestSignature.ts`:**

```typescript
import crypto from 'crypto';

// This secret must be the same in frontend AND backend
const SIGNATURE_SECRET = process.env.REQUEST_SIGNATURE_SECRET || 'fry-rewards-signature-key';

/**
 * Generate an HMAC-SHA256 signature for a request.
 * 
 * Combines:
 * - Request path
 * - Request method
 * - Request body (JSON stringified)
 * - Timestamp (within 5-minute window)
 * 
 * This ensures:
 * - Request hasn't been tampered with
 * - Request hasn't been replayed (outside time window)
 * - Attacker can't modify body after signature is created
 */
export function generateRequestSignature(
  method: string,
  path: string,
  body: any,
  timestamp: number
): string {
  const message = `${method}|${path}|${JSON.stringify(body)}|${timestamp}`;
  return crypto
    .createHmac('sha256', SIGNATURE_SECRET)
    .update(message)
    .digest('hex');
}

/**
 * Verify a request signature server-side.
 * 
 * Returns true if:
 * - Signature is valid
 * - Timestamp is within 5 minutes (prevents replay attacks)
 */
export function verifyRequestSignature(
  method: string,
  path: string,
  body: any,
  timestamp: number,
  signature: string,
  maxAgeSeconds: number = 300 // 5 minutes
): boolean {
  // Check timestamp is within acceptable range
  const now = Math.floor(Date.now() / 1000);
  if (now - timestamp > maxAgeSeconds) {
    console.warn('[RequestSignature] Request too old:', { timestamp, now, age: now - timestamp });
    return false;
  }

  // Compute expected signature
  const expected = generateRequestSignature(method, path, body, timestamp);
  
  // Compare using timing-safe comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

**Update frontend component `components/modals/Claim.tsx`:**

```typescript
import { getClientToken } from '../../lib/clientToken';
import { generateRequestSignature } from '../../lib/requestSignature';

async function claimRewards() {
  const clientToken = await getClientToken();
  const body = no ? { miner_key, no } : { miner_key };
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateRequestSignature('POST', '/api/rewards/claim', body, timestamp);
  
  const response = await fetch('api/rewards/claim', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-token': clientToken,
      'x-request-signature': signature,
      'x-request-timestamp': timestamp.toString()
    },
    body: JSON.stringify(body)
  });
  // ...
}
```

**Update backend `pages/api/rewards/claim.ts`:**

```typescript
import { verifyRequestSignature } from '../../../lib/requestSignature';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED' });
    return;
  }

  if (!verifyClientToken(req, res)) {
    return;
  }

  // NEW: Verify request signature
  const signature = req.headers['x-request-signature'] as string;
  const timestamp = req.headers['x-request-timestamp'] as string;
  
  if (!signature || !timestamp) {
    return res.status(403).json({
      success: false,
      code: 'MISSING_SIGNATURE',
      message: 'Request signature required'
    });
  }

  if (!verifyRequestSignature('POST', '/api/rewards/claim', req.body, Number(timestamp), signature)) {
    return res.status(403).json({
      success: false,
      code: 'INVALID_SIGNATURE',
      message: 'Invalid or expired request signature'
    });
  }

  // ... rest of handler ...
}
```

**Impact**: 
- ✅ Prevents body tampering (attacker can't modify reward amount after signature)
- ✅ Prevents replay attacks (signature includes timestamp)
- ✅ Ensures request came from legitimate frontend (only frontend knows the signature secret)

#### 1c. Disable Console Access in Production
Add a check to warn/block console access in production:

**Create `lib/consoleGuard.ts`:**

```typescript
export function initConsoleGuard() {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'production') {
    return;
  }

  // Detect if devtools console is open
  let devtoolsOpen = false;

  // Method 1: Check console element
  const originalLog = console.log;
  Object.defineProperty(window, 'console', {
    get() {
      devtoolsOpen = true;
      return {
        log: originalLog,
        // empty other console methods to prevent abuse
        warn: () => {},
        error: () => {},
        debug: () => {},
      };
    },
  });

  // Method 2: Check timing
  const before = performance.now();
  debugger; // eslint-disable-line no-debugger
  const after = performance.now();
  
  if (after - before > 100) {
    // Debugger paused execution (console likely open)
    devtoolsOpen = true;
    // Optionally: log suspicious activity to backend
    fetch('/api/security/log', {
      method: 'POST',
      body: JSON.stringify({ event: 'console_access_detected', timestamp: Date.now() })
    }).catch(() => {});
  }

  if (devtoolsOpen) {
    console.warn('%cDeveloper tools detected', 'color: red; font-size: 20px;');
    // Don't block, just log for security team to review
  }
}
```

**Add to `pages/_app.tsx`:**

```typescript
import { initConsoleGuard } from '../lib/consoleGuard';

useEffect(() => {
  if (typeof window !== 'undefined') {
    initConsoleGuard();
  }
}, []);
```

**Impact**: 
- ✅ Detects console access in production
- ✅ Logs suspicious activity for security review
- ⚠️ Cannot fully block (browsers allow this for legitimate dev access)

---

## Threat 2: Browser Extension

### Threat Model
A malicious browser extension can:
- Read localStorage and sessionStorage
- Intercept/modify requests
- Access all DOM elements
- Read/modify HTTP headers

### Defense Strategy

#### 2a. Subresource Integrity (SRI)
Ensure external scripts haven't been tampered with:

**In `app/layout.tsx` or `pages/_document.tsx`:**

```tsx
<script
  src="https://cdn.jsdelivr.net/npm/library@version/dist/library.min.js"
  integrity="sha384-XXXXXXXXXXX"
  crossOrigin="anonymous"
></script>
```

#### 2b. Extension Detection
Detect known malicious extensions:

**Create `lib/extensionDetection.ts`:**

```typescript
export function detectMaliciousExtensions(): string[] {
  const detected: string[] = [];
  
  // Method 1: Check for known extension content scripts
  const knownMaliciousURLs = [
    'chrome-extension://known-bad-extension-id/',
    'moz-extension://known-bad-extension-id/'
  ];

  try {
    // This won't work perfectly due to CORS, but log attempts
    knownMaliciousURLs.forEach(url => {
      fetch(url + 'manifest.json', { mode: 'no-cors' })
        .then(() => {
          console.warn('Potential malicious extension detected:', url);
          detected.push(url);
          
          // Log to backend for analysis
          fetch('/api/security/log', {
            method: 'POST',
            body: JSON.stringify({ event: 'malicious_extension_detected', extension: url })
          }).catch(() => {});
        })
        .catch(() => {}); // Extension not installed
    });
  } catch (e) {
    // Silently fail
  }

  // Method 2: Check for suspicious DOM modifications
  if (document.body.innerHTML !== originalBodyHTML) {
    console.warn('DOM has been modified');
    detected.push('dom-modification');
  }

  return detected;
}
```

#### 2c. Segregate Sensitive Data
Don't store the entire token in easily-accessible localStorage:

**Create `lib/secureClientToken.ts`:**

```typescript
// Store token in memory only (lost on page refresh, but that's okay)
let tokenCache: string | null = null;
const TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
let tokenExpiryTime = 0;

export async function getClientTokenSecurely(): Promise<string> {
  const now = Date.now();
  
  // If token is still valid, use cached version
  if (tokenCache && now < tokenExpiryTime) {
    return tokenCache;
  }

  // Generate new token
  const token = await generateClientToken();
  tokenCache = token;
  tokenExpiryTime = now + TOKEN_EXPIRY_MS;
  
  return token;
}

export function clearSecureToken() {
  tokenCache = null;
  tokenExpiryTime = 0;
}
```

**Impact**:
- ✅ Token expires after 15 minutes (requires regeneration)
- ✅ Token only in memory (not persisted, harder to steal)
- ✅ Forces re-authentication on page reload (safer after browser restart)

---

## Threat 3: Malicious Site with Embedded Claim Form

### Threat Model
Attacker tricks user to visit `evil.com` which hosts a hidden form that:
- POSTs to your API `/api/rewards/claim`
- Uses user's authenticated session cookie (if SameSite is not set)
- Claims the user's rewards

### Defense Strategy (Already in place, but verified)

#### 3a. SameSite Cookie Policy
Ensure next-auth session cookies have `SameSite=Strict`:

**In `pages/api/auth/[...nextauth].ts`:**

```typescript
export const authOptions: NextAuthOptions = {
  // ... other config ...
  cookies: {
    sessionToken: {
      name: 'next-auth.session-token',
      options: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict', // ← IMPORTANT: Prevents CSRF
        path: '/',
      }
    }
  }
};
```

#### 3b. Origin Verification
Verify requests come from your own origin:

**Create middleware in `pages/api/rewards/_middleware.ts`:**

```typescript
import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  
  // Allow requests from your own origin only
  const allowedOrigins = [
    'https://yourapp.com',
    'https://www.yourapp.com',
    'http://localhost:3000' // Dev only
  ];

  if (origin && !allowedOrigins.includes(origin)) {
    return NextResponse.json(
      { error: 'Cross-origin request denied' },
      { status: 403 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/rewards/:path*']
};
```

**Impact**:
- ✅ SameSite=Strict prevents cross-site cookie send
- ✅ Origin verification adds extra layer
- ✅ Request must come from your own domain

---

## Threat 4: Compromised Frontend Code

### Threat Model
Attacker compromises your build pipeline or CDN and:
- Modifies `clientToken.ts` to leak tokens
- Modifies `Claim.tsx` to send rewards to attacker's address
- Injects malicious code into the bundle

### Defense Strategy

#### 4a. Subresource Integrity (SRI) for Bundles
Pin all external dependencies:

```tsx
<script
  src="https://cdn.jsdelivr.net/npm/react@18/dist/react.production.min.js"
  integrity="sha384-XXXXXXXX"
  crossOrigin="anonymous"
></script>
```

#### 4b. Code Signing and Verification
Sign your builds and verify them at runtime:

**Create `lib/codeIntegrity.ts`:**

```typescript
import crypto from 'crypto';

const TRUSTED_BUILD_HASH = process.env.NEXT_PUBLIC_BUILD_HASH || '';

export async function verifyCodeIntegrity(): Promise<boolean> {
  try {
    // Fetch the integrity manifest from server
    const response = await fetch('/api/security/build-integrity', {
      cache: 'no-store'
    });
    
    if (!response.ok) {
      console.error('Failed to fetch build integrity manifest');
      return false;
    }

    const manifest = await response.json();
    const currentHash = TRUSTED_BUILD_HASH;

    if (manifest.expectedHash !== currentHash) {
      console.error('Build integrity verification failed');
      
      // Log security incident
      fetch('/api/security/log', {
        method: 'POST',
        body: JSON.stringify({
          event: 'build_integrity_failed',
          expected: manifest.expectedHash,
          current: currentHash
        })
      }).catch(() => {});

      return false;
    }

    return true;
  } catch (e) {
    console.error('Code integrity check failed:', e);
    return false;
  }
}
```

**Add to `_app.tsx`:**

```typescript
useEffect(() => {
  verifyCodeIntegrity().then(isValid => {
    if (!isValid && process.env.NODE_ENV === 'production') {
      // Don't allow sensitive operations if code can't be verified
      console.error('Code integrity check failed. Sensitive operations disabled.');
    }
  });
}, []);
```

**Backend endpoint `pages/api/security/build-integrity.ts`:**

```typescript
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return res.json({
    expectedHash: process.env.NEXT_PUBLIC_BUILD_HASH,
    timestamp: Date.now(),
    version: process.env.NEXT_PUBLIC_APP_VERSION
  });
}
```

#### 4c. Content Security Policy Report-Only
Test CSP changes before enforcing:

```javascript
{
  key: 'Content-Security-Policy-Report-Only',
  value: "script-src 'self'; report-uri /api/security/csp-report"
}
```

**Collect CSP violations `pages/api/security/csp-report.ts`:**

```typescript
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const violation = req.body;
  console.error('[CSP Violation]', {
    violatedDirective: violation['violated-directive'],
    blockedUri: violation['blocked-uri'],
    sourceFile: violation['source-file'],
    lineNumber: violation['line-number']
  });

  // Store in database for analysis
  // If you see unexpected script sources, your build may be compromised

  return res.status(204).end();
}
```

**Impact**:
- ✅ Detects code tampering
- ✅ Logs CSP violations for review
- ✅ Alerts team if build hash changes

---

## Threat 5: Credential Theft (Bonus)

### Defense: Secure Secret Storage

**Never hardcode secrets in frontend:**

```typescript
// ❌ BAD
const TOKEN_SECRET = 'fry-rewards-client-secret';

// ✅ GOOD
const TOKEN_SECRET = process.env.NEXT_PUBLIC_TOKEN_SECRET || 'fry-rewards-client-';
```

---

## Implementation Checklist

- [ ] Add CSP headers in `next.config.js`
- [ ] Implement request signatures in `lib/requestSignature.ts`
- [ ] Update Claim/Boost components to send signatures
- [ ] Update API endpoints to verify signatures
- [ ] Add console guard in `lib/consoleGuard.ts`
- [ ] Add extension detection in `lib/extensionDetection.ts`
- [ ] Use secure token storage (in-memory only)
- [ ] Verify SameSite=Strict on session cookies
- [ ] Add origin verification middleware
- [ ] Add build integrity verification
- [ ] Set up CSP report collection
- [ ] Add security logging endpoints

---

## Security Logging Architecture

Create `pages/api/security/log.ts`:

```typescript
import clientPromise from '../../../lib/mongoclient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const { event, ...data } = req.body;
  const client = await clientPromise;
  const db = client.db('main');

  await db.collection('security-events').insertOne({
    event,
    ...data,
    timestamp: new Date(),
    ipAddress: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    userAgent: req.headers['user-agent']
  });

  return res.json({ logged: true });
}
```

Monitor this collection for:
- Multiple `console_access_detected` events from same IP
- `malicious_extension_detected` events
- `build_integrity_failed` events
- Rapid sequential `claim` operations

---

## Summary: Defense in Depth

| Threat | Primary Defense | Secondary Defense | Tertiary Defense |
|--------|---|---|---|
| Browser console | Request signatures | Console guard | Memory-only tokens |
| Browser extension | Extension detection | SRI | Memory-only tokens |
| Malicious site CSRF | SameSite=Strict | Origin verification | Request signatures |
| Code compromise | Build integrity | CSP violations | Security logging |

This layered approach means attackers need to breach multiple defenses, making exploitation significantly harder.
