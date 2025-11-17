# Security Documentation Guide

## 📚 Essential Reading Order

### 1. **SECURITY_ONE_PAGER.md** ⭐ START HERE
- Overview of 4-layer security system
- Admin vs non-admin request flows
- Device fingerprinting (Layer 4)
- MongoDB security events structure
- Performance metrics

**Read this first to understand the complete architecture.**

### 3. **SECURITY_MONITORING.md** 📊
- Detailed monitoring implementation
- Event types and classifications
- MongoDB query examples
- Detection algorithms for coordinated attacks
- Rate limiting strategies

**Use this for operational monitoring and attack detection.**

---

### 4. **SECURITY_MONITORING_QUICK_REFERENCE.md** 📋
- Quick MongoDB query examples
- Attack detection patterns
- Common security events

**Quick lookup for common queries and patterns.**

---

## 🎯 By Use Case

### "I need to understand the security model"
→ Read **SECURITY_ONE_PAGER.md**

### "I need to monitor attacks"
→ Read **SECURITY_MONITORING.md**

### "I need a quick MongoDB query"
→ Read **SECURITY_MONITORING_QUICK_REFERENCE.md**

### "I'm running in dev mode"
→ Read **dev-mode.md**

---

## 🔒 The Four Security Layers

| Layer | Name | Non-Admin | Admin |
|-------|------|-----------|-------|
| 1 | Client Token | ✅ Enforced | ⏭️ Bypassed |
| 2 | Request Signature | ✅ Enforced | ⏭️ Bypassed |
| 3 | Session Validation | ✅ Enforced | ✅ Enforced |
| 4 | Device Fingerprinting | ✅ Enforced | ⏭️ Bypassed + Logged |

**Result**: Non-admin gets full security. Admin gets speed with full audit trail.

---

## 📂 Key Files

| File | Purpose |
|------|---------|
| `lib/deviceFingerprint.ts` | Device fingerprinting implementation |
| `pages/api/rewards/*.ts` | All 7 protected endpoints |
| `lib/clientTokenMiddleware.ts` | Layer 1 verification |
| `lib/requestSignature.server.ts` | Layer 2 verification |

---

## 🚀 Quick Start

1. **Understand**: Read SECURITY_ONE_PAGER.md (5 min)
2. **Test**: Follow SECURITY_TESTING_GUIDE.md (10 min)
3. **Monitor**: Use SECURITY_MONITORING.md queries (ongoing)

---

## 📊 MongoDB Security Events

```javascript
// Query all security events
db['security-events'].find({})

// Query fingerprinting events
db['security-events'].find({ eventType: /DEVICE_FINGERPRINT/ })

// Query admin bypasses
db['security-events'].find({ isAdmin: true })

// Query last 10 events for a wallet
db['security-events']
  .find({ walletAddress: "YOUR_ADDRESS" })
  .sort({ timestamp: -1 })
  .limit(10)
```

---

## ✅ Status

- **Build**: ✅ Compiles successfully (0 errors)
- **Tests**: ✅ All security layers implemented
- **Deployment**: ✅ Ready for production

---

**Last Updated**: After consolidation of 31 security docs into 4 essentials
