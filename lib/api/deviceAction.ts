import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'node:crypto';
import {
  acquireDeviceLock,
  releaseDeviceLock,
  appendJournalEntry,
  type DeviceAction,
  type DeviceTransactionJournal,
  type AppendJournalEntryParams
} from '../db/requestLocks';
import { createApiError, ErrorCodes } from '../api-errors';
import { notifyDiscordError } from '../discord-webhook';
import { enforceOperationRateLimit } from './operationRateLimit';

export interface DeviceActionContext {
  miner_key: string;
  address: string;
  action: DeviceAction;
  metadata?: Record<string, unknown>;
}

/**
 * The BASE idempotency key for a request. Deliberately left as-is: it is what
 * `device_request_locks` records for the in-flight request, and a client that sends
 * `x-idempotency-key` still pins it. Note that for a claim-all it is stable for the life of the
 * device - Claim.tsx posts the identical body `{miner_key}` every time - so it identifies the
 * DEVICE+ACTION, not the attempt. The attempt is identified by the key `appendJournalEntry`
 * returns below, which derives from this one.
 */
const deriveIdempotencyKey = (req: NextApiRequest, bodyHashSeed: Record<string, unknown>) => {
  const headerKey = req.headers['x-idempotency-key'];
  if (typeof headerKey === 'string' && headerKey.trim().length > 0) {
    return headerKey.trim();
  }

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(bodyHashSeed))
    .update(req.method ?? 'POST')
    .digest('hex');
};

export interface DeviceActionResult<T = unknown> {
  response?: T;
  journal?: {
    status?: DeviceTransactionJournal['status'];
    txId?: string;
    /** Says which transaction of the settled group `txId` is, so the audit row never has to be
     *  guessed at. The user-pays path sets it from /api/rewards/confirm's writeback instead. */
    txIdSource?: DeviceTransactionJournal['txIdSource'];
    error?: string;
    metadata?: Record<string, unknown>;
  };
}

export const withDeviceActionLock = async <T>(
  req: NextApiRequest,
  res: NextApiResponse,
  context: DeviceActionContext,
  handler: (params: { idempotencyKey: string }) => Promise<DeviceActionResult<T> | void>
): Promise<void> => {
  const { miner_key, address, action, metadata } = context;
  const idempotencyKey = deriveIdempotencyKey(req, { body: req.body, miner_key, address, action });

  const rateLimit = await enforceOperationRateLimit({
    req,
    res,
    action,
    minerKey: miner_key,
    address
  });
  if (!rateLimit.allowed) {
    return;
  }

  const lockAcquired = await acquireDeviceLock({
    action,
    miner_key,
    address,
    idempotencyKey,
    metadata: { ...metadata, ip: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress }
  });

  if (!lockAcquired) {
    res.status(409).json(
      createApiError(
        ErrorCodes.ACTION_IN_PROGRESS,
        'A previous request for this action is still in progress.',
        'Wait for the previous action to complete before retrying.'
      )
    );
    return;
  }

  // The key of the audit row this attempt owns. It is the base key for a device's first attempt
  // and a discriminated one (`<base>#2`, ...) once an earlier attempt has settled, so a confirmed
  // row is never reopened by the next claim. Resolved by the `open` write below.
  let journalKey = idempotencyKey;

  try {
    journalKey = await appendJournalEntry({
      miner_key,
      action,
      idempotencyKey,
      walletAddress: address,
      request: req.body ?? {},
      status: 'pending',
      metadata,
      phase: 'open'
    });

    const result = (await handler({ idempotencyKey: journalKey })) ?? {};

    const journalUpdate: Pick<AppendJournalEntryParams, 'status' | 'txId' | 'txIdSource' | 'error' | 'metadata'> = {
      status: result.journal?.status ?? 'confirmed',
      txId: result.journal?.txId,
      txIdSource: result.journal?.txIdSource,
      error: result.journal?.error,
      metadata: {
        ...metadata,
        ...(result.journal?.metadata ?? {})
      }
    };

    await appendJournalEntry({
      miner_key,
      action,
      idempotencyKey: journalKey,
      walletAddress: address,
      request: req.body ?? {},
      status: journalUpdate.status,
      txId: journalUpdate.txId,
      txIdSource: journalUpdate.txIdSource,
      error: journalUpdate.error,
      metadata: journalUpdate.metadata
    });

    if (!res.headersSent) {
      res.status(200).json(result.response ?? { success: true });
    }
  } catch (error: any) {
    const status = typeof error?.status === 'number' ? error.status : 500;
    const payload = error?.response && typeof error.response === 'object'
      ? error.response
      : createApiError(ErrorCodes.INTERNAL_ERROR, 'Request failed to complete.', error?.message);

    await appendJournalEntry({
      miner_key,
      action,
      idempotencyKey: journalKey,
      walletAddress: address,
      request: req.body ?? {},
      status: 'failed',
      error: payload?.message,
      metadata
    });

    void notifyDiscordError({
      minerKey: miner_key,
      walletAddress: address,
      issueType: `DEVICE_ACTION_${action}`,
      part: 'withDeviceActionLock.catch',
      errorMessage: payload?.message ?? String(error ?? 'Unknown error'),
      endpoint: req.url ?? undefined,
      metadata: {
        status,
        idempotencyKey: journalKey,
        action,
        originalError: error instanceof Error ? error.message : error,
        ...(metadata ?? {})
      }
    });

    if (!res.headersSent) {
      res.status(status).json(payload);
    }
  } finally {
    await releaseDeviceLock(action, miner_key);
  }
};
