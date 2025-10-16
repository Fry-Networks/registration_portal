# Security Event Logging - Format and Examples

## Overview

All security events (Layers 1-2, 4) are now logged to **both console and MongoDB** with two complementary approaches:

1. **Console logs**: Real-time visibility of security events
2. **Aggregated MongoDB**: Efficient storage with per-wallet summaries and event counters

This approach provides **real-time monitoring** without database bloat.

---

## Storage Strategy

### ❌ Old Approach (Not Used Anymore)
- **Problem**: Create 1 document per event = millions of documents
- **Result**: Database grows uncontrollably
- **Query Time**: Slow (must scan millions of docs)

### ✅ New Approach (Current)
- **Solution**: 1 document per wallet with counters + rolling window of recent events
- **Result**: Database has thousands of documents instead of millions
- **Storage Savings**: ~99% reduction in storage
- **Query Time**: Fast (O(1) lookups by wallet address)

### Examples

#### Layer 1 - Client Token (Missing)
```
[L1 - ClientToken] 2025-10-16T17:13:40.499Z - No client token provided | Wallet: ESM3XCELKLF2IGLOU6BRCYEP3XNGVOYEJFWVSAJLUS6FX2UOFTK7PLJUPY | Miner: REDACTED_ROTATE_ME
```

#### Layer 1 - Client Token (Invalid)
```
[L1 - ClientToken] 2025-10-16T17:14:22.156Z - Client token does not match User-Agent | Wallet: ESM3XCELKLF2IGLOU6BRCYEP3XNGVOYEJFWVSAJLUS6FX2UOFTK7PLJUPY | Miner: REDACTED_ROTATE_ME
```

#### Layer 1 - Client Token (Admin Bypass)
```
[L1 - ClientToken] 2025-10-16T17:15:10.234Z - Admin bypass allowed | Wallet: ADMIN-WALLET-ADDRESS | Miner: ADMIN-MINER-KEY
```

#### Layer 2 - Request Signature (Expired)
```
[L2 - RequestSignature] 2025-10-16T17:16:45.890Z - Request timestamp expired | Wallet: ESM3XCELKLF2... | Miner: AOTCM-YXBPFE58...
```

#### Layer 2 - Request Signature (Invalid)
```
[L2 - RequestSignature] 2025-10-16T17:17:30.567Z - Signature verification failed | Wallet: ESM3XCELKLF2... | Miner: AOTCM-YXBPFE58...
```

#### Layer 2 - Request Signature (Tampered)
```
[L2 - RequestSignature] 2025-10-16T17:18:15.123Z - Request body tampering detected | Wallet: ESM3XCELKLF2... | Miner: AOTCM-YXBPFE58...
```

#### Layer 4 - Device Fingerprint (Missing)
```
[L4 - DeviceFingerprint] 2025-10-16T17:13:40.499Z - No fingerprint in session | Wallet: ESM3XCELKLF2IGLOU6BRCYEP3XNGVOYEJFWVSAJLUS6FX2UOFTK7PLJUPY | Miner: REDACTED_ROTATE_ME
```

#### Layer 4 - Device Fingerprint (Mismatch - Script Detected)
```
[L4 - DeviceFingerprint] 2025-10-16T17:14:50.721Z - Device fingerprint mismatch - script detected | Wallet: ESM3XCELKLF2... | Miner: AOTCM-YXBPFE58...
  Stored fingerprint: 3a7f2e1c5d9b42...
  Current fingerprint: a1b2c3d4e5f6g7...
  Stored User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)...
  Current User-Agent: python-requests/2.28.0
```

#### Layer 4 - Device Fingerprint (Admin Bypass)
```
[L4 - DeviceFingerprint] 2025-10-16T17:15:33.456Z - Admin bypass allowed | Wallet: ADMIN-WALLET | Miner: ADMIN-MINER-KEY
```

---

## MongoDB Document Format - Aggregated Summary (Efficient!)

Instead of creating 1 document per event (which would explode the database), we maintain **1 document per wallet** in the `security-events` collection that gets **updated** for each event:

```javascript
{
  _id: ObjectId("..."),
  
  // Wallet identification
  walletAddress: "ESM3XCELKLF2IGLOU6BRCYEP3XNGVOYEJFWVSAJLUS6FX2UOFTK7PLJUPY",
  minerKey: "REDACTED_ROTATE_ME",
  
  // Total counters (incremented on each event, not a new doc)
  totalEvents: 42,
  
  // Layer 1 event counters
  l1_missing_token: 5,
  l1_invalid_token: 2,
  
  // Layer 2 event counters
  l2_invalid_signature: 8,
  l2_expired_timestamp: 1,
  l2_tampered_request: 0,
  
  // Layer 4 event counters
  l4_bypass: 2,           // Admin bypasses (logged for audit)
  l4_missing_fingerprint: 3,
  l4_fingerprint_mismatch: 21,  // Script attacks detected
  
  // Severity counters
  critical_events: 1,
  high_events: 28,
  medium_events: 10,
  low_events: 3,
  
  // Recent events (rolling window of last 50)
  recentEvents: [
    {
      timestamp: ISODate("2025-10-16T17:13:40.499Z"),
      layer: 4,
      eventType: "DEVICE_FINGERPRINT_MISMATCH",
      endpoint: "/api/rewards/claim",
      severity: "high",
      blocked: true,
      details: "Device fingerprint mismatch - script detected"
    },
    // ... up to 50 events
  ],
  
  // Status indicators
  lastEventTimestamp: ISODate("2025-10-16T17:30:00.000Z"),
  lastEventType: "DEVICE_FINGERPRINT_MISMATCH",
  lastBlocked: true,
  
  // Document lifecycle
  firstSeenAt: ISODate("2025-10-16T10:00:00.000Z"),
  updatedAt: ISODate("2025-10-16T17:30:00.000Z")
}
```

### Key Advantage: Aggregated Storage

Instead of creating millions of documents:
```javascript
// ❌ OLD: Insert 1 document per event (would create DB bloat)
db['security-events'].insertOne({
  timestamp: ISODate("2025-10-16T17:13:40.499Z"),
  walletAddress: "ESM3XCEL...",
  layer: 4,
  eventType: "DEVICE_FINGERPRINT_MISMATCH",
  // ... more fields
}) // Called 42 times = 42 documents!
```

We update 1 document:
```javascript
// ✅ NEW: Update 1 document 42 times (efficient!)
db['security-events'].updateOne(
  { walletAddress: "ESM3XCEL..." },
  { 
    $inc: { totalEvents: 1, l4_fingerprint_mismatch: 1, high_events: 1 },
    $push: { recentEvents: { $each: [newEvent], $slice: -50 } },
    $set: { lastEventTimestamp, lastEventType, updatedAt }
  },
  { upsert: true }
)
```

**Result**: 
- **Old approach**: ~10,000 documents per day in production = GB per week
- **New approach**: ~10K-100K documents total (one per wallet) = MB total
- **Storage savings**: ~99% reduction in database growth!

---

## Layer Breakdown

### Layer 1: Client Token
| Event | Level | Meaning |
|-------|-------|---------|
| Admin bypass allowed | ℹ️ Info | Admin wallet bypassed token check (logged for audit) |
| No client token provided | ⚠️ Warn | Missing x-client-token header |
| Client token does not match User-Agent | ⚠️ Warn | Invalid token for this User-Agent |

**Stored in MongoDB as**: `eventType: "MISSING_CLIENT_TOKEN"` or `"INVALID_CLIENT_TOKEN"`

---

### Layer 2: Request Signature
| Event | Level | Meaning |
|-------|-------|---------|
| Admin bypass allowed | ℹ️ Info | Admin wallet bypassed signature check (logged for audit) |
| Request timestamp expired | ⚠️ Warn | Request older than 5 minutes |
| Request timestamp in future | ⚠️ Warn | Client clock is ahead of server |
| Signature verification failed | ⚠️ Warn | HMAC-SHA256 signature doesn't match |
| Request body tampering detected | 🔴 Critical | Body modified after signature was created |

**Stored in MongoDB as**: `eventType: "MISSING_SIGNATURE"`, `"INVALID_SIGNATURE"`, `"EXPIRED_TIMESTAMP"`, or `"TAMPERED_REQUEST"`

---

### Layer 3: Session Validation
**Note**: Layer 3 uses existing NextAuth validation. Not yet integrated into new logging system but always enforced.

---

### Layer 4: Device Fingerprinting
| Event | Level | Meaning |
|-------|-------|---------|
| Admin bypass allowed | ℹ️ Info | Admin wallet bypassed fingerprint check + logged |
| No fingerprint in session | 🔴 Critical | User logged in but no fingerprint stored |
| Device fingerprint mismatch - script detected | 🔴 Critical | Different device/browser detected (script attack!) |

**Stored in MongoDB as**: `eventType: "DEVICE_FINGERPRINT_BYPASS"`, `"DEVICE_FINGERPRINT_MISSING"`, or `"DEVICE_FINGERPRINT_MISMATCH"`

---

## MongoDB Queries

### View all wallet security summaries (aggregated)
```javascript
db['security-events'].find({}).pretty()
```

### View security summary for a specific wallet
```javascript
db['security-events'].findOne({
  walletAddress: "ESM3XCELKLF2IGLOU6BRCYEP3XNGVOYEJFWVSAJLUS6FX2UOFTK7PLJUPY"
})
```

### View recent events for a wallet
```javascript
db['security-events'].findOne(
  { walletAddress: "ESM3XCEL..." },
  { projection: { recentEvents: { $slice: -10 } } }  // Last 10 events
)
```

### Find wallets with high Device Fingerprint mismatch counts (potential attacks)
```javascript
db['security-events'].find({
  l4_fingerprint_mismatch: { $gte: 5 }
}).sort({ l4_fingerprint_mismatch: -1 })
```

### Find wallets with recent security events
```javascript
db['security-events'].find({
  updatedAt: { $gte: new Date(new Date() - 3600000) }  // Last 1 hour
}).sort({ updatedAt: -1 })
```

### Count total events across all wallets by type
```javascript
db['security-events'].aggregate([
  { $group: { 
      _id: null,
      totalL1Tokens: { $sum: '$l1_missing_token' },
      totalL1Invalid: { $sum: '$l1_invalid_token' },
      totalL2Signature: { $sum: '$l2_invalid_signature' },
      totalL2Expired: { $sum: '$l2_expired_timestamp' },
      totalL4Bypass: { $sum: '$l4_bypass' },
      totalL4Mismatch: { $sum: '$l4_fingerprint_mismatch' },
      totalCritical: { $sum: '$critical_events' }
    }
  }
])
```

### Find top 10 most attacked wallets (by fingerprint mismatch)
```javascript
db['security-events'].aggregate([
  { $sort: { l4_fingerprint_mismatch: -1 } },
  { $limit: 10 },
  { $project: { 
      walletAddress: 1, 
      minerKey: 1,
      l4_fingerprint_mismatch: 1,
      totalEvents: 1,
      lastEventTimestamp: 1
    }
  }
])
```

### Statistics summary
```javascript
db['security-events'].aggregate([
  { $group: {
      _id: null,
      totalWallets: { $sum: 1 },
      avgEventsPerWallet: { $avg: '$totalEvents' },
      totalEvents: { $sum: '$totalEvents' },
      totalCritical: { $sum: '$critical_events' }
    }
  }
])
```

---

## Severity Levels

| Severity | Color | Meaning |
|----------|-------|---------|
| low | 🟢 Green | Admin bypass (expected and allowed) |
| medium | 🟡 Yellow | Minor security check failed, but could be false positive |
| high | 🟠 Orange | Serious security violation, likely attack |
| critical | 🔴 Red | Critical security breach, definite attack pattern |

---

## Integration Points

### Files Logging Events

1. **`lib/deviceFingerprint.ts`** (Layer 4)
   - Logs: Device fingerprinting events
   - Events: BYPASS, MISSING, MISMATCH

2. **`lib/clientTokenMiddleware.ts`** (Layer 1)
   - Logs: Client token events
   - Events: MISSING_CLIENT_TOKEN, INVALID_CLIENT_TOKEN

3. **`lib/requestSignature.server.ts`** (Layer 2)
   - Logs: Request signature events
   - Events: EXPIRED_TIMESTAMP, INVALID_SIGNATURE, TAMPERED_REQUEST

### Protected Endpoints

All events logged for any of these endpoints:
- POST `/api/rewards/claim`
- POST `/api/rewards/boost`
- POST `/api/rewards/confirm`
- GET `/api/rewards/get-asset-totals`
- GET `/api/rewards/get-reward-summary`
- GET `/api/rewards/get-rewards-page`
- GET `/api/rewards/get-reward-records`

---

## Example Real-World Scenario

### Attack Attempt
```
[L1 - ClientToken] 2025-10-16T17:20:10.123Z - No client token provided | Wallet: unknown | Miner: unknown
[L1 - ClientToken] 2025-10-16T17:20:11.456Z - No client token provided | Wallet: unknown | Miner: unknown
[L1 - ClientToken] 2025-10-16T17:20:12.789Z - No client token provided | Wallet: unknown | Miner: unknown
```
**Analysis**: Automated bot trying to call API without proper headers. Blocked at Layer 1.

---

### Legitimate User
```
[L1 - ClientToken] 2025-10-16T17:21:00.100Z - Client token verified | Wallet: ESM3XCEL... | Miner: AOTCM-YXB...
[L2 - RequestSignature] 2025-10-16T17:21:00.105Z - Signature verified | Wallet: ESM3XCEL... | Miner: AOTCM-YXB...
[L3 - Session] Authorization passed
[L4 - DeviceFingerprint] 2025-10-16T17:21:00.110Z - Fingerprint matched | Wallet: ESM3XCEL... | Miner: AOTCM-YXB...
✅ Request processed successfully
```

---

### Script Attack (with Stolen Cookie)
```
[L4 - DeviceFingerprint] 2025-10-16T17:22:00.500Z - Device fingerprint mismatch - script detected | Wallet: ESM3XCEL... | Miner: AOTCM-YXB...
  Stored fingerprint: 3a7f2e1c5d9b42...
  Current fingerprint: a1b2c3d4e5f6g7...
  Stored User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)
  Current User-Agent: python-requests/2.28.0
❌ Request blocked - script detected
```
**Analysis**: Even with valid session/signature, script was blocked because device fingerprint changed from browser to Python.

---

## Performance Note

All logging is **asynchronous and non-blocking**:
- Console logs appear immediately (no delay)
- MongoDB writes happen in background
- API response not delayed by logging operations
- Logging failures don't affect request processing

