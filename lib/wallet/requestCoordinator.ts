import type { Collection, ObjectId } from 'mongodb';
import crypto from 'node:crypto';
import clientPromise from '../mongoclient';

export class WalletRequestInFlightError extends Error {
  constructor() {
    super('Wallet request already in progress');
    this.name = 'WalletRequestInFlightError';
  }
}

interface WalletRequestLock {
  _id?: ObjectId;
  address: string;
  operation: string;
  lockId: string;
  expiresAt: Date;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

const WALLET_LOCKS_COLLECTION = 'wallet_operation_locks';
const DEFAULT_LOCK_TTL_MS = 30000; // 30 seconds for wallet operations

const ensureWalletLockCollection = async (): Promise<Collection<WalletRequestLock>> => {
  const client = await clientPromise;
  const db = client.db('main');
  const collection = db.collection<WalletRequestLock>(WALLET_LOCKS_COLLECTION);

  // Ensure indexes for automatic TTL cleanup and uniqueness
  await collection.createIndex({ address: 1, operation: 1 }, { unique: true });
  await collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await collection.createIndex({ createdAt: -1 });

  return collection;
};

const acquireGlobalWalletLock = async (
  address: string,
  operation: string = 'wallet_operation',
  ttlMs: number = DEFAULT_LOCK_TTL_MS,
  metadata?: Record<string, unknown>
): Promise<string | null> => {
  const collection = await ensureWalletLockCollection();
  const lockId = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);

  try {
    await collection.insertOne({
      address,
      operation,
      lockId,
      expiresAt,
      createdAt: now,
      metadata
    });
    
    return lockId;
  } catch (error: any) {
    // Document already exists (unique constraint violation)
    if (error?.code === 11000) {
      return null;
    }
    throw error;
  }
};

const releaseGlobalWalletLock = async (
  address: string,
  operation: string = 'wallet_operation'
): Promise<void> => {
  const collection = await ensureWalletLockCollection();
  await collection.deleteOne({ address, operation });
};

/**
 * Global wallet request coordinator using persistent MongoDB locks.
 * 
 * This replaces the memory-based coordinator that was vulnerable to double-spending
 * during deployment restarts. The new system:
 * - Persists across deployments
 * - Uses automatic TTL cleanup (30s default)
 * - Prevents concurrent wallet operations globally
 * - Provides detailed operation tracking
 */
export const runWithWalletRequest = async <T>(
  task: () => Promise<T>,
  options?: {
    address?: string;
    operation?: string;
    ttlMs?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<T> => {
  // Default operation type for backwards compatibility
  const operation = options?.operation ?? 'wallet_operation';
  const address = options?.address ?? 'global';
  const ttlMs = options?.ttlMs ?? DEFAULT_LOCK_TTL_MS;
  const metadata = options?.metadata;

  const lockId = await acquireGlobalWalletLock(address, operation, ttlMs, metadata);
  
  if (!lockId) {
    throw new WalletRequestInFlightError();
  }

  try {
    return await task();
  } finally {
    await releaseGlobalWalletLock(address, operation);
  }
};

/**
 * Legacy compatibility function - checks if any wallet operation is active.
 * Note: This now checks the database instead of memory.
 */
export const isWalletRequestActive = async (
  address: string = 'global', 
  operation: string = 'wallet_operation'
): Promise<boolean> => {
  try {
    const collection = await ensureWalletLockCollection();
    const activeLock = await collection.findOne({ 
      address, 
      operation,
      expiresAt: { $gt: new Date() }
    });
    return !!activeLock;
  } catch (error) {
    // If we can't check the database, assume no lock (fail open)
    console.error('Failed to check wallet request lock:', error);
    return false;
  }
};

/**
 * Emergency function to force release all locks for a specific wallet address.
 * Use with caution - only for emergency cleanup or support scenarios.
 */
export const forceReleaseWalletLocksForAddress = async (address: string): Promise<number> => {
  const collection = await ensureWalletLockCollection();
  const result = await collection.deleteMany({ address });
  return result.deletedCount ?? 0;
};

/**
 * Get active wallet locks for monitoring/debugging purposes.
 */
export const getActiveWalletLocks = async (): Promise<WalletRequestLock[]> => {
  const collection = await ensureWalletLockCollection();
  return await collection.find({ 
    expiresAt: { $gt: new Date() } 
  }).sort({ createdAt: -1 }).toArray();
};
