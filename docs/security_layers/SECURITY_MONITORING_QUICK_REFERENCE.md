# Security Monitoring Quick Reference

## What Was Implemented

✅ **Complete Security Event Monitoring System**
- Tracks bot attacks, tampering, and unauthorized access
- Logs to MongoDB with wallet/miner_key targeting
- Non-blocking async logging (doesn't slow down APIs)
- Attack detection for coordinated campaigns

## Files Created/Modified

### New Files
| File | Purpose |
|------|---------|
| `lib/securityMonitoring.ts` | Core monitoring system (5 key functions) |
| `pages/api/security/events.ts` | Query security events API |
| `pages/api/security/summary.ts` | Security statistics API |
| `test-security-monitoring.mjs` | Test suite |
| `SECURITY_MONITORING.md` | Comprehensive documentation |

### Modified Files
| File | Changes |
|------|---------|
| `lib/requestSignature.ts` | Added logging on signature failures |
| `lib/clientTokenMiddleware.ts` | Added logging on token failures |

## Key Components

### 1. Core Monitoring System (`lib/securityMonitoring.ts`)

```typescript
// Log a security event
logSecurityEvent(req, 'INVALID_SIGNATURE', 'high', 'Signature verification failed')

// Query events
getSecurityEvents({
  wallet: 'AAAAA...',
  severity: 'critical',
  startDate: new Date('2024-01-15T00:00:00Z')
})

// Get statistics
getSecuritySummary('AAAAA...', undefined)

// Check if under attack
isUnderAttack('AAAAA...', undefined)  // Returns true if 3+ high/critical events in 5 min
```

### 2. Query APIs

**Security Events**: `GET /api/security/events?wallet=...&severity=critical`
```json
{
  "events": [...],
  "total": 15,
  "underAttack": true,
  "summary": { ... }
}
```

**Security Summary**: `GET /api/security/summary?wallet=...`
```json
{
  "total_events": 45,
  "by_type": { "INVALID_SIGNATURE": 30, ... },
  "by_severity": { "high": 30, ... },
  "critical_events": 0,
  "underAttack": false
}
```

## Event Types Tracked (8 total)

| Type | Layer | Severity | Meaning |
|------|-------|----------|---------|
| `MISSING_CLIENT_TOKEN` | 1 | medium | No token provided |
| `INVALID_CLIENT_TOKEN` | 1 | medium | Token check failed |
| `MISSING_SIGNATURE` | 2 | high | No signature provided |
| `INVALID_SIGNATURE` | 2 | high | Signature mismatch |
| `EXPIRED_TIMESTAMP` | 2 | high | Request too old (>5 min) |
| `TAMPERED_REQUEST` | 2 | **critical** | Body was modified |
| `UNAUTHORIZED_WALLET` | 3 | high | Wrong wallet |
| `UNAUTHORIZED_MINER` | 3 | high | Not device owner |

## Quick Start

### 1. Verify Setup
```bash
# TypeScript should compile with no errors
npx tsc --noEmit --skipLibCheck
# Exit code should be 0
```

### 2. Run Tests
```bash
# Start dev server first (in another terminal)
npm run dev

# In another terminal, run tests
node test-security-monitoring.mjs
```

### 3. Query Security Events (from browser/curl)
```javascript
// In authenticated context (with valid session)
fetch('/api/security/events?wallet=AAAAA...&severity=high')
  .then(r => r.json())
  .then(data => console.log(data.events))

fetch('/api/security/summary?wallet=AAAAA...')
  .then(r => r.json())
  .then(data => {
    if (data.underAttack) {
      console.warn('Wallet is under active attack!');
    }
  })
```

## Protected Endpoints (All 7)

All endpoints now reject requests without valid security layers:

1. ✅ `POST /api/rewards/claim`
2. ✅ `POST /api/rewards/boost`
3. ✅ `POST /api/rewards/confirm`
4. ✅ `GET /api/rewards/get-asset-totals`
5. ✅ `GET /api/rewards/get-reward-summary`
6. ✅ `GET /api/rewards/get-rewards-page`
7. ✅ `GET /api/rewards/get-reward-records`

## Security Architecture (Fail-Fast Pattern)

```
Request
  ↓
[Layer 1] Client Token Check → 403 if invalid (no DB query)
  ↓
[Layer 2] Request Signature → 403 if invalid (no DB query)
  ↓
[Layer 3] Session Validation → 401 if invalid
  ↓
Business Logic
```

**Benefits**: Bots fail at layers 1-2 with minimal CPU overhead. Database only queried for legitimate requests.

## Device Fingerprint Layer (Layer 4)

- After a wallet signs in, the browser must call `POST /api/auth/capture-fingerprint` once to bind the session to its headers (User-Agent, Accept-Language, etc.).
- Protected reward APIs enforce fingerprint matches via `verifyDeviceFingerprintMiddleware`. Failures log one of:
  - `DEVICE_FINGERPRINT_MISSING` (session never captured)
  - `DEVICE_FINGERPRINT_MISMATCH` (headers differ from captured fingerprint)
  - `DEVICE_FINGERPRINT_BYPASS` (admin or global bypass)
- Successful captures log `DEVICE_FINGERPRINT_CAPTURED` into `security-events` for observability.
- Emergency bypass: set `DISABLE_DEVICE_FINGERPRINT=true|1|yes` (server env) to skip Layer 4 checks; all requests will be logged as `DEVICE_FINGERPRINT_BYPASS` with a “global bypass” detail.

## Attack Detection Logic

A wallet/miner is considered **under attack** if:

```
(3+ high severity events in last 5 minutes)
  OR
(1+ critical severity event in last 5 minutes)
```

Examples of triggering events:
- 3 consecutive invalid signature attempts = under attack
- 1 body tampering attempt = under attack
- Mix of timestamp expiry + invalid signature = under attack

## Data Flow Diagram

```
API Request
  ↓
verifyClientToken() → logs MISSING/INVALID_CLIENT_TOKEN
  ↓
verifyRequestSignature() → logs MISSING/INVALID/EXPIRED/TAMPERED
  ↓
Session validation → logs UNAUTHORIZED_WALLET/MINER
  ↓
[All failures] → logSecurityEvent(req, type, severity, msg)
  ↓
[Async] → MongoDB security-events collection
  ↓
Query APIs → /api/security/events, /api/security/summary
```

## Performance Impact

- **Bot requests**: <1ms rejection at layer 1-2
- **Valid requests**: ~5ms overhead for crypto operations
- **Event logging**: Async, non-blocking (doesn't slow API responses)
- **Database**: Indexes on wallet, miner_key, timestamp for fast queries

## Next Steps / Optional Enhancements

1. **Rate Limiting**: Use `isUnderAttack()` to trigger HTTP 429
   ```javascript
   if (await isUnderAttack(wallet)) {
     return res.status(429).json({ error: 'Too many requests' });
   }
   ```

2. **Dashboard**: Create UI to visualize attacks
   - Events over time
   - Top attacking IPs
   - Targeted wallets/miners

3. **Alerting**: Email/Slack on critical events
   - Critical events (body tampering)
   - Coordinated attacks (3+ events in 5 min)

4. **Data Retention**: Delete old events
   ```javascript
   db.collection('security-events').deleteMany({
     timestamp: { $lt: new Date(Date.now() - 90*24*60*60*1000) }
   })
   ```

## MongoDB Indexes

Automatically created by `ensureSecurityEventIndexes()`:

```javascript
wallet, miner_key, ip_address, type, severity, timestamp
wallet + timestamp, miner_key + timestamp
```

These enable efficient queries for:
- Finding all attacks on a wallet
- Getting recent events by type/severity
- IP-based attack pattern analysis

## Deployment Checklist

- [ ] `.env` contains `REQUEST_SIGNATURE_SECRET`
- [ ] MongoDB `main` database exists
- [ ] Run `ensureSecurityEventIndexes()` on startup
- [ ] Start dev server and verify no TypeScript errors
- [ ] All 7 endpoints respond with 403/401 without valid tokens
- [ ] Query APIs require authentication (401 without session)
- [ ] Review SECURITY_MONITORING.md for complete details

## Troubleshooting

**Q: Why do valid requests show 403?**
A: Client token or signature is missing/invalid. Check that frontend is generating and sending both headers.

**Q: Can I query events without authentication?**
A: No, both `/api/security/events` and `/api/security/summary` require a valid NextAuth session.

**Q: How long are events stored?**
A: Indefinitely until manually deleted. Set up periodic cleanup to archive old events.

**Q: What if MongoDB write fails?**
A: Event logging doesn't block API responses. Failures are logged to console only.

---

**Full Documentation**: See `SECURITY_MONITORING.md`
