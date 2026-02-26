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

  try {
    await appendJournalEntry({
      miner_key,
      action,
      idempotencyKey,
      walletAddress: address,
      request: req.body ?? {},
      status: 'pending',
      metadata
    });

    const result = (await handler({ idempotencyKey })) ?? {};

    const journalUpdate: Pick<AppendJournalEntryParams, 'status' | 'txId' | 'error' | 'metadata'> = {
      status: result.journal?.status ?? 'confirmed',
      txId: result.journal?.txId,
      error: result.journal?.error,
      metadata: {
        ...metadata,
        ...(result.journal?.metadata ?? {})
      }
    };

    await appendJournalEntry({
      miner_key,
      action,
      idempotencyKey,
      walletAddress: address,
      request: req.body ?? {},
      status: journalUpdate.status,
      txId: journalUpdate.txId,
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
      idempotencyKey,
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
        idempotencyKey,
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
