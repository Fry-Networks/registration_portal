# Build Fix: MongoDB Module Resolution Error

## Problem

The Next.js build failed with webpack errors for Node.js-only modules:
```
Module not found: Can't resolve 'dns'
Module not found: Can't resolve 'fs'
Module not found: Can't resolve 'net'
Module not found: Can't resolve 'tls'
```

**Root Cause**: MongoDB (a server-only library) was being imported into client components through this chain:
```
Claim.tsx (client)
  ↓ imports
components/modals/Claim.tsx
  ↓
lib/requestSignature.ts (client-side functions)
  ↓ imports
lib/securityMonitoring.ts (server-only, uses MongoDB)
  ↓
lib/mongoclient.ts (requires 'dns', 'fs', 'net', 'tls')
  ↓
webpack tries to bundle for browser ❌
```

## Solution

Split `lib/requestSignature.ts` into **two separate files**:

### 1. `lib/requestSignature.client.ts` (NEW)
**Purpose**: Client-side signature generation only
```typescript
export async function generateRequestSignatureAsync(
  method: string,
  path: string,
  body: any,
  timestamp: number
): Promise<string> {
  // Uses Web Crypto API (browser only)
  // NO imports of MongoDB, server modules, or anything Node.js-specific
}
```

**Key Features**:
- Uses `crypto.subtle` (Web Crypto API, browser-native)
- No server-only dependencies
- Safe to bundle into client code
- Used by `Claim.tsx` and `Boost.tsx` components

### 2. `lib/requestSignature.server.ts` (NEW)
**Purpose**: Server-side signature verification only
```typescript
export function verifyRequestSignature(
  method: string,
  path: string,
  body: any,
  timestamp: number,
  signature: string,
  req?: NextApiRequest
): boolean {
  // Uses Node.js crypto module
  // Uses dynamic imports for securityMonitoring (non-blocking)
}
```

**Key Features**:
- Uses `require('crypto')` (Node.js)
- Uses dynamic imports for `logSecurityEvent`
- Server-side only, never bundled for browser
- Used by all 7 reward API endpoints

## Files Changed

### Created Files (2)
1. `lib/requestSignature.client.ts` - Client signature generation
2. `lib/requestSignature.server.ts` - Server signature verification

### Updated Files (11)

**Client Components (2)**:
- `components/modals/Claim.tsx`
  - Changed: `import from '../../lib/requestSignature'`
  - To: `import from '../../lib/requestSignature.client'`

- `components/modals/Boost.tsx`
  - Changed: `import from '../../lib/requestSignature'`
  - To: `import from '../../lib/requestSignature.client'`

**API Endpoints (7)**:
- `pages/api/rewards/claim.ts`
- `pages/api/rewards/boost.ts`
- `pages/api/rewards/confirm.ts`
- `pages/api/rewards/get-asset-totals.ts`
- `pages/api/rewards/get-reward-summary.ts`
- `pages/api/rewards/get-rewards-page.ts`
- `pages/api/rewards/get-reward-records.ts`

All changed: `import from '../../../lib/requestSignature'` → `import from '../../../lib/requestSignature.server'`

**Middleware (2)**:
- `lib/clientTokenMiddleware.ts`
  - Removed: `import { logSecurityEvent } from './securityMonitoring'`
  - Added: Dynamic import in function calls

- `lib/requestSignature.server.ts`
  - Uses: Dynamic imports for logging (already implemented)

## Build Result

✅ **Build Status**: Successful
- Next.js build: Completed without errors
- TypeScript check: Passed (0 errors)
- Webpack bundling: No module resolution errors
- Client bundle: Clean (no MongoDB)
- Server API: Fully functional

## How It Works Now

### Client-Side Flow
```
Claim.tsx needs to send signed request
  ↓
import { generateRequestSignatureAsync } from 'requestSignature.client'
  ↓
compute HMAC-SHA256 with Web Crypto API
  ↓
send request with x-request-signature header
  ↓
webpack bundles: ✅ No MongoDB in bundle
```

### Server-Side Flow
```
POST /api/rewards/claim arrives at server
  ↓
import { verifyRequestSignature } from 'requestSignature.server'
  ↓
extract signature from x-request-signature header
  ↓
verify with Node.js crypto
  ↓
if invalid → dynamic import logSecurityEvent
  ↓
log event to MongoDB (async, non-blocking)
```

## Verification

Run the following to verify:

```bash
# Build production bundle
npm run build

# Check TypeScript
npx tsc --noEmit --skipLibCheck

# Start dev server
npm run dev
```

All should complete without errors.

## Security Implications

✅ **Security preserved**:
- Client-side signature generation still uses Web Crypto API
- Server-side verification still uses HMAC-SHA256
- Logging still records security events
- No functionality lost, only module organization changed

## Notes

- The original `lib/requestSignature.ts` file is no longer used and can be deleted
- All imports have been updated (checked 11 files)
- Dynamic imports prevent MongoDB from being bundled into client code
- Performance unchanged (async logging already in place)
