# Finalize AirAPI Decoupling Migration Plan

## Executive Summary

The user-dashboard has been partially migrated to become independent from AirAPI. The backend infrastructure is complete with a new "creds" database and API endpoints, but the frontend components still heavily rely on AirAPI. This document outlines the exact steps needed to complete the migration and achieve full independence from AirAPI.

### Current State
- **Backend**: ✅ Complete - New "creds" database with portal-based collections
- **API Endpoints**: ✅ Complete - `/api/credentials/*` endpoints implemented
- **Frontend**: ❌ Incomplete - Still calls AirAPI via `NEXT_PUBLIC_API_HOST`
- **Dependencies**: 45+ AirAPI references still active in frontend code

### Migration Goal
Transform from hybrid system to fully independent dashboard:
```
Current: User Dashboard → AirAPI (partial) + MongoDB creds (partial)
Target:  User Dashboard → MongoDB creds (complete)
```

## Architecture Analysis

### Old Architecture (Being Replaced)
```
User Dashboard (Port 3007) 
    ↓ NEXT_PUBLIC_API_HOST
AirAPI (Port 3000) 
    ↓ 
MongoDB (main database)
```

### New Architecture (Target)
```
User Dashboard (Port 3007) 
    ↓ Internal API calls
MongoDB (creds database)
```

## Completed Components ✅

### 1. Database Infrastructure
- **New Database**: `creds` (replacing AirAPI's `main` DB)
- **Collections**: Portal-based organization (`air`, `camera`, `weather`, `radiation`, `water`, `hardware`, `energy`)
- **Location**: `../user-dashboard/pages/api/devices/save-credentials.ts`

### 2. Backend API Endpoints
- **`/api/credentials/get`** - Retrieve credentials from creds DB
- **`/api/credentials/validate`** - Validate credentials with portal-specific validators
- **`/api/credentials/unlink`** - Remove credentials
- **Portal-specific validators**: `/api/credentials/hardware/mac`, `/api/credentials/energy/shelly`, etc.

### 3. Authentication & Security
- NextAuth.js session-based authentication
- Address-based authorization
- Portal-specific access controls

## Critical Components Still Needing Migration ❌

### 1. Frontend Components (45+ Files)

#### Device Modals (All need credential retrieval updates)
```
components/modals/water/Iopool.tsx
components/modals/water/Ecowitt.tsx
components/modals/Pebble.tsx
components/modals/energy/Ecowitt.tsx
components/modals/energy/Tapo.tsx
components/modals/Ecowitt.tsx
components/modals/Atmotube.tsx
components/modals/Kaiterra.tsx
components/modals/Govee.tsx
components/modals/Sensecap.tsx
components/modals/Nrf.tsx
components/modals/Purpleair.tsx
components/modals/Awair.tsx
components/modals/radiation/GmcMap.tsx
components/modals/weather/Lacrosse.tsx
components/modals/weather/WeatherXM.tsx
components/modals/Airthings.tsx
components/modals/weather/Ambient.tsx
components/modals/weather/Sensecap.tsx
components/modals/weather/Ecowitt.tsx
```

**Issue**: All these files call:
```typescript
const response = await fetch('/api/credentials/get', {
  method: 'POST',
  // ...
});
```

**Fix**: Replace with:
```typescript
const response = await fetch('/api/credentials/get', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ miner_key })
});
```

#### Portal Pages (All need device submission updates)
```
pages/airportal.tsx
pages/weatherportal.tsx
pages/energyportal.tsx
pages/waterportal.tsx
pages/radiationportal.tsx
pages/cameraportal.tsx
```

**Air Portal Endpoints to Replace**:
```typescript
// CURRENT (AirAPI calls)
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitkey`           // Ambient
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitEcokey`        // Ecowitt
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitpebble`        // Pebble
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitpurple`        // Purple Air
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitAwair`         // Awair
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitKaiterra`      // Kaiterra
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitAtmotube`      // Atmotube
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitGoveeKey`      // Govee
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitNRF`           // NRF
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitSenseCAPKey`   // Sensecap

// NEW (Dashboard internal calls)
'/api/devices/save-credentials'  // All device types
```

**Weather Portal Endpoints to Replace**:
```typescript
// CURRENT
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitkey`           // Ambient
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitEcokey`        // Ecowitt
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitXMToken`       // WeatherXM
`${process.env.NEXT_PUBLIC_API_HOST}/api/getTemperature`      // Temperature check
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitSenseCAPKey`   // Sensecap

// NEW
'/api/devices/save-credentials'  // All device types
```

**Energy Portal Endpoints to Replace**:
```typescript
// CURRENT
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitTapo`          // Tapo
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitEcokey`        // Ecowitt

// NEW
'/api/devices/save-credentials'  // All device types
```

**Water Portal Endpoints to Replace**:
```typescript
// CURRENT
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitIopool`        // Iopool
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitEcokey`        // Ecowitt

// NEW
'/api/devices/save-credentials'  // All device types
```

**Radiation Portal Endpoints to Replace**:
```typescript
// CURRENT
`${process.env.NEXT_PUBLIC_API_HOST}/api/submitGmcMap`        // GMC Map

// NEW
'/api/devices/save-credentials'  // All device types
```

**Camera Portal Endpoints to Replace**:
```typescript
// CURRENT
`/api/credentials/get`  // Get credentials (legacy callers should call this)
`/api/credentials/camera/rtsp`         // Validate RTSP (canonical validator endpoint)

// NEW (canonical)
 '/api/credentials/get'           // Get credentials
 '/api/credentials/validate'      // Validate credentials (portal-specific validators)

// Support/Debug: A CLI is available for quick RTSP checks using the shared library:
// node scripts/check-rtsp.js <rtsp-url>
```

### 2. Environment Variables

#### Files to Update
```
.env.local (if exists)
.env.example
docker-compose.yml
next.config.js
```

**Remove/Update**:
```bash
# Remove these dependencies
NEXT_PUBLIC_API_HOST
NEXT_PUBLIC_AIR_API_PORT
```

**Add**:
```bash
# Add if not present
MONGO_CREDS_DB=creds  # (defaults to 'creds' anyway)
```

### 3. Device Submission Logic

#### Missing API Endpoints to Create
The following AirAPI endpoints need to be recreated in the dashboard:

```
/api/devices/submit/ambient
/api/devices/submit/ecowitt
/api/devices/submit/pebble
/api/devices/submit/purple
/api/devices/submit/awair
/api/devices/submit/kaiterra
/api/devices/submit/atmotube
/api/devices/submit/govee
/api/devices/submit/nrf
/api/devices/submit/sensecap
/api/devices/submit/weatherxm
/api/devices/submit/lacrosse
/api/devices/submit/tapo
/api/devices/submit/iopool
/api/devices/submit/gmcmap
/api/devices/submit/rtsp
```

Each endpoint should:
1. Validate credentials using `/api/credentials/validate`
2. Store credentials in "creds" database using `/api/devices/save-credentials`
3. Return success/failure response

## Detailed Migration Tasks

### Phase 1: Frontend Component Updates

#### Task 1.1: Update Device Modals
For each modal file in `components/modals/`:

**Current Code Pattern**:
```typescript
const response = await fetch('/api/credentials/get', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ miner_key, type })
});
```

**Replace With**:
```typescript
const response = await fetch('/api/credentials/get', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ miner_key })
});
```

**Files to Update**: 22 modal files (listed above)

#### Task 1.2: Update Portal Pages
For each portal page:

**Current Code Pattern**:
```typescript
const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/submit${Endpoint}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    miner_key: minerKey,
    // ... device-specific fields
    address: session?.user.address
  })
});
```

**Replace With**:
```typescript
const response = await fetch('/api/devices/save-credentials', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    miner_key: minerKey,
    portal: 'air', // or 'weather', 'energy', etc.
    api_type: 'ambient', // or device-specific type
    credentials: {
      // ... device-specific credential fields
    },
    address: session?.user.address
  })
});
```

**Files to Update**: 6 portal pages (listed above)

### Phase 2: Backend API Creation

#### Task 2.1: Create Device Submission Endpoints
Create new endpoints in `pages/api/devices/submit/`:

**Example: `pages/api/devices/submit/ambient.ts`**
```typescript
import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../auth/[...nextauth]';
import { saveCredentials } from '../../save-credentials';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { miner_key, key } = req.body;
  if (!miner_key || !key) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // Save credentials
    await saveCredentials({
      miner_key,
      portal: 'air',
      api_type: 'ambient',
      credentials: { apiKey: key },
      address: session.user.address
    });

    res.status(200).json({ message: 'Ambient device registered successfully' });
  } catch (error) {
    console.error('Ambient submission error:', error);
    res.status(500).json({ message: 'Failed to register device' });
  }
}
```

**Endpoints to Create**: 16 submission endpoints

#### Task 2.2: Update Portal Page API Calls
Update each portal page to call the new submission endpoints:

**Example for AirPortal**:
```typescript
const handleAmbient = async (apiKey: string): Promise<boolean> => {
  try {
    const response = await fetch('/api/devices/submit/ambient', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        miner_key: minerKey,
        key: apiKey,
        address: session?.user.address
      })
    });

    const result = await response.json();
    if (!response.ok) {
      toast.error({ heading: 'Error', message: result.message });
      return false;
    } else {
      toast.success({ heading: 'Success', message: result.message });
    }

    // Continue with existing navigation logic...
  } catch (error) {
    // Error handling...
  }
  return true;
};
```

### Phase 3: Environment & Configuration

#### Task 3.1: Update Environment Files
1. Remove `NEXT_PUBLIC_API_HOST` from all environment files
2. Add `MONGO_CREDS_DB=creds` if not present
3. Update Docker configurations if needed

#### Task 3.2: Update Package Scripts
Ensure no scripts reference AirAPI endpoints or dependencies.

### Phase 4: Data Migration (Optional)

#### Task 4.1: Migrate Existing Data
If existing device credentials in AirAPI need to be preserved:

```javascript
// Migration script example
const { MongoClient } = require('mongodb');

async function migrateCredentials() {
  const sourceClient = new MongoClient(process.env.MONGO_URI);
  const targetClient = new MongoClient(process.env.MONGO_URI);
  
  try {
    await sourceClient.connect();
    await targetClient.connect();
    
    const sourceDb = sourceClient.db('main');
    const targetDb = targetClient.db('creds');
    
    // Migrate device_credentials
    const sourceCollection = sourceDb.collection('device_credentials');
    const targetCollection = targetDb.collection('other');
    
    const credentials = await sourceCollection.find({}).toArray();
    
    for (const cred of credentials) {
      // Map to new schema
      const mapped = {
        miner_key: cred.miner_key,
        address: cred.address,
        credentials: cred.credentials,
        api_type: cred.type,
        portal: mapTypeToPortal(cred.type),
        credentials_saved_at: cred.updatedAt || new Date()
      };
      
      await targetCollection.updateOne(
        { miner_key: cred.miner_key, address: cred.address },
        { $set: mapped },
        { upsert: true }
      );
    }
    
    console.log(`Migrated ${credentials.length} credentials`);
  } finally {
    await sourceClient.close();
    await targetClient.close();
  }
}

function mapTypeToPortal(type) {
  const portalMap = {
    'ambient': 'air',
    'awair': 'air',
    'atmotube': 'air',
    'govee': 'air',
    'kaiterra': 'air',
    'nrf': 'air',
    'pebble': 'air',
    'purple': 'air',
    'sensecap': 'air',
    'ecowitt': 'weather',
    'lacrosse': 'weather',
    'tempest': 'weather',
    'weatherxm': 'weather',
    'tapo': 'energy',
    'shelly': 'energy',
    'switchbot': 'energy',
    'iopool': 'water',
    'gmcmap': 'radiation',
    'camera': 'camera',
    'rtsp': 'camera'
  };
  
  return portalMap[type] || 'other';
}
```

## Risk Assessment & Rollback Plan

### High Risk Areas
1. **Frontend Component Updates**: 45+ files need updates - risk of missing some
2. **Device Submission Logic**: Complex credential validation logic
3. **Environment Dependencies**: Other services might reference AirAPI

### Medium Risk Areas
1. **Data Migration**: Potential data loss during migration
2. **Authentication**: Session handling differences between systems

### Low Risk Areas
1. **Database Structure**: Already implemented and tested
2. **API Endpoints**: Already implemented and tested

### Rollback Strategy
1. **Keep AirAPI Running**: Don't decommission AirAPI until migration is fully tested
2. **Feature Flags**: Use environment variables to switch between old/new systems
3. **Database Backups**: Create backups before any data migration
4. **Gradual Rollout**: Test one portal at a time

### Testing Checklist

#### Pre-Migration Testing
- [ ] Backup current databases
- [ ] Test new API endpoints in isolation
- [ ] Verify authentication works with new system
- [ ] Test credential retrieval and storage

#### Portal-Specific Testing
- [ ] Air Portal: All 11 device types
- [ ] Weather Portal: All 5 device types  
- [ ] Energy Portal: All 3 device types
- [ ] Water Portal: All 2 device types
- [ ] Radiation Portal: 1 device type
- [ ] Camera Portal: RTSP validation

#### Post-Migration Testing
- [ ] Verify no AirAPI calls in network tab
- [ ] Test device registration flows end-to-end
- [ ] Verify credential retrieval works
- [ ] Test error handling and validation
- [ ] Load testing with multiple concurrent users

## Implementation Timeline

### Week 1: Preparation
- **Day 1-2**: Create backup and rollback procedures
- **Day 3-4**: Set up development environment with feature flags
- **Day 5**: Implement device submission endpoints

### Week 2: Frontend Migration
- **Day 1-2**: Update all device modals (22 files)
- **Day 3-4**: Update portal pages (6 files)
- **Day 5**: Test credential retrieval functionality

### Week 3: Testing & Refinement
- **Day 1-2**: Portal-specific testing
- **Day 3-4**: Integration testing
- **Day 5**: Performance testing

### Week 4: Deployment
- **Day 1**: Staging deployment and testing
- **Day 2**: Production deployment with feature flags
- **Day 3-4**: Monitor and fix issues
- **Day 5**: Full rollout and AirAPI decommissioning

## Success Criteria

### Technical Success
- [ ] Zero AirAPI references in frontend code
- [ ] All device registration flows working
- [ ] Credential storage and retrieval functional
- [ ] No performance degradation
- [ ] All automated tests passing

### Business Success
- [ ] No user-facing downtime
- [ ] All existing functionality preserved
- [ ] Improved system reliability
- [ ] Reduced operational complexity

## Post-Migration Benefits

### Immediate Benefits
1. **Reduced Complexity**: One less service to maintain
2. **Improved Performance**: No network calls to external API
3. **Better Security**: Consolidated authentication
4. **Easier Debugging**: Single codebase to troubleshoot

### Long-term Benefits
1. **Cost Savings**: Reduced infrastructure costs
2. **Scalability**: Easier to scale single service
3. **Development Speed**: Faster feature development
4. **Reliability**: Fewer points of failure

## Monitoring & Maintenance

### Key Metrics to Monitor
- API response times
- Error rates by endpoint
- Database query performance
- User success rates for device registration

### Alerting Setup
- High error rates on credential endpoints
- Database connection failures
- Authentication failures
- Performance degradation

### Regular Maintenance Tasks
- Database optimization
- Log cleanup
- Security audits
- Performance tuning

---

## Conclusion

This migration plan provides a comprehensive roadmap to completely decouple the user-dashboard from AirAPI. The backend infrastructure is already in place, so the focus should be on frontend component updates and thorough testing.

**Critical Success Factors:**
1. Meticulous attention to detail when updating 45+ frontend files
2. Comprehensive testing of each device type and portal
3. Proper rollback procedures in case of issues
4. Gradual rollout with feature flags

**Estimated Timeline**: 4 weeks from start to completion
**Risk Level**: Medium (mitigated by keeping AirAPI running during transition)
**Business Impact**: Low risk, high reward in terms of simplification and performance

Following this plan will result in a more maintainable, performant, and reliable system that's easier to develop and operate.
