/**
 * Security Event Monitoring System
 * Tracks bot attacks, tampering attempts, and suspicious activity
 */

import clientPromise from './mongoclient';
import { NextApiRequest } from 'next';

export interface SecurityEvent {
  timestamp: Date;
  type: 'MISSING_CLIENT_TOKEN' | 'INVALID_CLIENT_TOKEN' | 'MISSING_SIGNATURE' | 'INVALID_SIGNATURE' | 'EXPIRED_TIMESTAMP' | 'TAMPERED_REQUEST' | 'UNAUTHORIZED_WALLET' | 'UNAUTHORIZED_MINER';
  severity: 'low' | 'medium' | 'high' | 'critical';
  endpoint: string;
  method: string;
  wallet?: string;
  miner_key?: string;
  ip_address?: string;
  user_agent?: string;
  request_body?: any;
  error_message?: string;
  blocked: boolean;
}

/**
 * Extract wallet from request body or headers
 */
function extractWallet(req: NextApiRequest): string | undefined {
  try {
    if (req.body?.address) return req.body.address;
    if (req.body?.wallet) return req.body.wallet;
    if (req.headers['x-wallet']) return req.headers['x-wallet'] as string;
  } catch (e) {
    // Silently fail
  }
  return undefined;
}

/**
 * Extract miner_key from request body
 */
function extractMinerKey(req: NextApiRequest): string | undefined {
  try {
    if (req.body?.miner_key) return req.body.miner_key;
  } catch (e) {
    // Silently fail
  }
  return undefined;
}

/**
 * Get client IP address
 */
function getClientIp(req: NextApiRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0];
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Log a security event
 */
export async function logSecurityEvent(
  req: NextApiRequest,
  type: SecurityEvent['type'],
  severity: SecurityEvent['severity'],
  errorMessage?: string
): Promise<void> {
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('security-events');

    const event: SecurityEvent = {
      timestamp: new Date(),
      type,
      severity,
      endpoint: req.url || 'unknown',
      method: req.method || 'UNKNOWN',
      wallet: extractWallet(req),
      miner_key: extractMinerKey(req),
      ip_address: getClientIp(req),
      user_agent: req.headers['user-agent'] as string,
      error_message: errorMessage,
      blocked: true,
    };

    // Don't log full request body for privacy, but log keys for analysis
    if (req.body) {
      event.request_body = {
        keys: Object.keys(req.body),
        address_provided: !!req.body.address,
        miner_key_provided: !!req.body.miner_key,
      };
    }

    await collection.insertOne(event);

    // Log critical events to console
    if (severity === 'critical') {
      console.warn(`🚨 CRITICAL SECURITY EVENT:`, {
        type,
        wallet: event.wallet,
        miner_key: event.miner_key,
        ip: event.ip_address,
        endpoint: event.endpoint,
        message: errorMessage,
      });
    }
  } catch (err) {
    console.error('Failed to log security event:', err);
    // Don't throw - don't let logging failures break the API
  }
}

/**
 * Get security events for monitoring/analysis
 */
export async function getSecurityEvents(
  filters?: {
    wallet?: string;
    miner_key?: string;
    endpoint?: string;
    type?: SecurityEvent['type'];
    severity?: SecurityEvent['severity'];
    startDate?: Date;
    endDate?: Date;
    limit?: number;
  }
): Promise<SecurityEvent[]> {
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection<SecurityEvent>('security-events');

    const query: any = {};

    if (filters?.wallet) query.wallet = filters.wallet;
    if (filters?.miner_key) query.miner_key = filters.miner_key;
    if (filters?.endpoint) query.endpoint = new RegExp(filters.endpoint, 'i');
    if (filters?.type) query.type = filters.type;
    if (filters?.severity) query.severity = filters.severity;

    if (filters?.startDate || filters?.endDate) {
      query.timestamp = {};
      if (filters.startDate) query.timestamp.$gte = filters.startDate;
      if (filters.endDate) query.timestamp.$lte = filters.endDate;
    }

    const limit = Math.min(filters?.limit || 100, 1000);

    return await collection
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();
  } catch (err) {
    console.error('Failed to retrieve security events:', err);
    return [];
  }
}

/**
 * Get security summary/statistics
 */
export async function getSecuritySummary(
  wallet?: string,
  minerKey?: string
): Promise<{
  total_events: number;
  by_type: Record<string, number>;
  by_severity: Record<string, number>;
  last_event: SecurityEvent | null;
  critical_events: number;
}> {
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection<SecurityEvent>('security-events');

    const query: any = {};
    if (wallet) query.wallet = wallet;
    if (minerKey) query.miner_key = minerKey;

    const events = await collection.find(query).toArray();

    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let criticalCount = 0;

    for (const event of events) {
      byType[event.type] = (byType[event.type] || 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;
      if (event.severity === 'critical') criticalCount++;
    }

    const lastEvent = events.length > 0 ? events[0] : null;

    return {
      total_events: events.length,
      by_type: byType,
      by_severity: bySeverity,
      last_event: lastEvent,
      critical_events: criticalCount,
    };
  } catch (err) {
    console.error('Failed to get security summary:', err);
    return {
      total_events: 0,
      by_type: {},
      by_severity: {},
      last_event: null,
      critical_events: 0,
    };
  }
}

/**
 * Check if wallet/miner_key is under attack (multiple events in time window)
 */
export async function isUnderAttack(
  wallet?: string,
  minerKey?: string,
  timeWindowSeconds: number = 300
): Promise<boolean> {
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection<SecurityEvent>('security-events');

    const query: any = {
      timestamp: {
        $gte: new Date(Date.now() - timeWindowSeconds * 1000),
      },
      severity: { $in: ['high', 'critical'] },
    };

    if (wallet) query.wallet = wallet;
    if (minerKey) query.miner_key = minerKey;

    const count = await collection.countDocuments(query);
    return count >= 3; // Consider under attack if 3+ events in time window
  } catch (err) {
    console.error('Failed to check attack status:', err);
    return false;
  }
}

/**
 * Create indexes for efficient queries
 */
export async function ensureSecurityEventIndexes(): Promise<void> {
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('security-events');

    await collection.createIndex({ timestamp: -1 });
    await collection.createIndex({ wallet: 1 });
    await collection.createIndex({ miner_key: 1 });
    await collection.createIndex({ ip_address: 1 });
    await collection.createIndex({ type: 1 });
    await collection.createIndex({ severity: 1 });
    await collection.createIndex({ 'timestamp': -1, 'wallet': 1 });
    await collection.createIndex({ 'timestamp': -1, 'miner_key': 1 });

    console.log('✓ Security event indexes created');
  } catch (err) {
    console.error('Failed to create indexes:', err);
  }
}
