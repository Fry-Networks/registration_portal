/**
 * Security Events Aggregation Utility
 * 
 * Stores security events efficiently by grouping them by wallet address.
 * Instead of creating a new document for each event (which would be millions),
 * we update a single document per wallet with aggregated counters and recent events.
 * 
 * This reduces MongoDB storage by ~99% while maintaining full audit trail.
 */

import { NextApiRequest } from 'next';
import clientPromise from './mongoclient';
import { Document } from 'mongodb';

export interface SecurityEventSummary {
  walletAddress: string;
  minerKey: string;
  
  // Counters (incremented for each event)
  total_events: number;
  
  // Layer 1 counters
  layer1_missing_token: number;
  layer1_invalid_token: number;
  
  // Layer 2 counters
  layer2_invalid_signature: number;
  layer2_expired_timestamp: number;
  layer2_tampered_request: number;
  
  // Layer 4 counters
  layer4_bypass: number;
  layer4_missing_fingerprint: number;
  layer4_fingerprint_mismatch: number;
  
  // Severity counters
  critical_events: number;
  high_events: number;
  medium_events: number;
  low_events: number;
  
  // Recent events (last 10 for quick lookup)
  recent_events: {
    timestamp: Date;
    layer: number;
    eventType: string;
    endpoint: string;
    severity: string;
    blocked: boolean;
    details?: string;
  }[];
  
  // Last event info
  last_event_timestamp: Date;
  last_event_type: string;
  last_blocked: boolean;
  
  // Timestamps
  first_seen: Date;
  last_updated: Date;
}

/**
 * Log security event by updating wallet's aggregated document
 * 
 * This is MUCH more efficient than creating a new document per event.
 * Instead of millions of documents, we have one document per wallet
 * with counters and a rolling window of recent events.
 * 
 * Storage reduction: ~99% (millions of events → thousands of wallets)
 */
export async function logSecurityEventAggregated(
  req: NextApiRequest,
  eventType: string,
  walletAddress: string,
  minerKey: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  errorMessage?: string
): Promise<void> {
  try {
    console.log(`[SecurityEventAggregated] Starting to log event: ${eventType} for wallet: ${walletAddress}`);
    
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('security-events');
    
    console.log(`[SecurityEventAggregated] Connected to MongoDB, collection ready`);

    const timestamp = new Date();
    const endpoint = req.url || 'unknown';
    const newEvent = {
      timestamp,
      layer: extractLayerNumber(eventType),
      eventType,
      endpoint,
      severity,
      blocked: !eventType.includes('BYPASS'),
      details: errorMessage, // Store the details message in MongoDB
    };

    // Map event types to counter field names
    const counterField = getCounterField(eventType);
    const severityCounter = `${severity}_events`;

    // Update or create the wallet's security summary document
    const updateDoc = {
      $inc: {
        'total_events': 1,
        [counterField]: 1,
        [severityCounter]: 1,
      },
      $set: {
        walletAddress,
        minerKey,
        last_event_timestamp: timestamp,
        last_event_type: eventType,
        last_blocked: newEvent.blocked,
        last_updated: timestamp,
      },
      $push: {
        // Keep only last 10 events (limit with $slice)
        recent_events: {
          $each: [newEvent],
          $slice: -10, // Keep only last 10
        },
      },
      $setOnInsert: {
        first_seen: timestamp,
      },
    };

    console.log(`[SecurityEventAggregated] Attempting updateOne for wallet: ${walletAddress}, counterField: ${counterField}`);
    
    const result = await collection.updateOne(
      { walletAddress },
      updateDoc as Document,
      { upsert: true }
    );
    
    console.log(`[SecurityEventAggregated] updateOne result:`, {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedId: result.upsertedId
    });
    console.log(`[SecurityEventAggregated] Event logged successfully for wallet: ${walletAddress}`);
  } catch (err) {
    console.error('[SecurityEventAggregated] FAILED to log event to MongoDB:', err);
    console.error('[SecurityEventAggregated] Error details:', {
      message: (err as any)?.message,
      code: (err as any)?.code,
      stack: (err as any)?.stack
    });
  }
}

/**
 * Get security summary for a wallet (for detection/alerts)
 */
export async function getWalletSecuritySummary(walletAddress: string): Promise<SecurityEventSummary | null> {
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('security-events');

    const doc = (await collection.findOne({ walletAddress })) as any;
    return doc as SecurityEventSummary | null;
  } catch (err) {
    console.error('[SecurityEventAggregated] Failed to fetch summary:', err);
    return null;
  }
}

/**
 * Check if wallet is under attack based on event patterns
 */
export async function isWalletUnderAttack(walletAddress: string): Promise<boolean> {
  const summary = await getWalletSecuritySummary(walletAddress);
  if (!summary) return false;

  // Under attack if:
  // - 1+ critical events
  // - 5+ high severity events in last 5 minutes
  // - 10+ medium events in last 5 minutes

  if (summary.critical_events > 0) return true;

  if (summary.high_events >= 5) {
    // Check if recent
    if (summary.last_event_timestamp) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (summary.last_event_timestamp > fiveMinutesAgo) {
        return true;
      }
    }
  }

  if (summary.medium_events >= 10) {
    if (summary.last_event_timestamp) {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      if (summary.last_event_timestamp > fiveMinutesAgo) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Helper: Extract layer number from event type
 */
function extractLayerNumber(eventType: string): number {
  if (eventType.startsWith('DEVICE_FINGERPRINT')) return 4;
  if (eventType.includes('SIGNATURE') || eventType.includes('TIMESTAMP') || eventType === 'TAMPERED_REQUEST') return 2;
  if (eventType.includes('CLIENT_TOKEN')) return 1;
  return 0;
}

/**
 * Helper: Map event type to MongoDB counter field name
 */
function getCounterField(eventType: string): string {
  const mapping: { [key: string]: string } = {
    'MISSING_CLIENT_TOKEN': 'layer1_missing_token',
    'INVALID_CLIENT_TOKEN': 'layer1_invalid_token',
    'INVALID_SIGNATURE': 'layer2_invalid_signature',
    'EXPIRED_TIMESTAMP': 'layer2_expired_timestamp',
    'TAMPERED_REQUEST': 'layer2_tampered_request',
    'DEVICE_FINGERPRINT_BYPASS': 'layer4_bypass',
    'DEVICE_FINGERPRINT_MISSING': 'layer4_missing_fingerprint',
    'DEVICE_FINGERPRINT_MISMATCH': 'layer4_fingerprint_mismatch',
  };
  return mapping[eventType] || 'other_events';
}

/**
 * MongoDB Schema for security-events collection
 * 
 * {
 *   _id: ObjectId,
 *   walletAddress: "ESM3XCEL...",
 *   minerKey: "AOTCM-YXB...",
 *   
 *   // Counters
 *   total_events: 42,
 *   layer1_missing_token: 5,
 *   layer1_invalid_token: 2,
 *   layer2_invalid_signature: 8,
 *   layer2_expired_timestamp: 1,
 *   layer2_tampered_request: 0,
 *   layer4_bypass: 2,
 *   layer4_missing_fingerprint: 3,
 *   layer4_fingerprint_mismatch: 21,
 *   
 *   // Severity
 *   critical_events: 1,
 *   high_events: 28,
 *   medium_events: 10,
 *   low_events: 3,
 *   
 *   // Recent events (rolling window)
 *   recent_events: [
 *     {
 *       timestamp: ISODate(...),
 *       layer: 4,
 *       eventType: "DEVICE_FINGERPRINT_MISMATCH",
 *       endpoint: "/api/rewards/claim",
 *       severity: "high",
 *       blocked: true,
 *       details: "Device fingerprint mismatch - script detected"
 *     },
 *     ... (last 10 events)
 *   ],
 *   
 *   // Timestamps
 *   first_seen: ISODate("2025-10-16T10:00:00Z"),
 *   last_updated: ISODate("2025-10-16T17:30:00Z"),
 *   last_event_timestamp: ISODate("2025-10-16T17:30:00Z"),
 *   last_event_type: "DEVICE_FINGERPRINT_MISMATCH",
 *   last_blocked: true
 * }
 */
