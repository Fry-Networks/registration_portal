import type { NextApiRequest, NextApiResponse } from 'next';
import { loggers } from '../../../lib/logger';
import {
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

type ClientErrorBody = {
  message?: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  issueType?: string;
  part?: string;
  reason?: unknown;
  walletAddress?: string | null;
  minerKey?: string | null;
  url?: string;
};

const ENDPOINT = '/api/logging/client-error';

/**
 * Normalize an error message coming from the browser.
 * Some callers invoke the logger with `console.error({})`, which results in an empty string.
 * We try to extract something meaningful from the `message`, `reason`, or `stack` fields so
 * the downstream Discord alert has actionable text instead of `[object Object]`.
 */
const deriveMessage = (body: ClientErrorBody): string => {
  if (typeof body.message === 'string' && body.message.trim().length > 0) {
    return body.message.trim().slice(0, 2000);
  }
  if (body.reason) {
    try {
      const serialized = JSON.stringify(body.reason);
      if (serialized && serialized !== '{}') {
        return `Client error reason: ${serialized.slice(0, 2000)}`;
      }
    } catch {
      const reasonString = String(body.reason);
      if (reasonString && reasonString !== '[object Object]') {
        return reasonString.slice(0, 2000);
      }
    }
  }
  if (typeof body.stack === 'string' && body.stack.trim().length > 0) {
    return body.stack.trim().split('\n')[0]?.slice(0, 2000) ?? 'Unknown client error';
  }
  return 'Unknown client error';
};

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Only POST requests are supported',
        'Submit client runtime errors with POST.'
      )
    );
    return;
  }

  try {
    const body = (req.body ?? {}) as ClientErrorBody;
    const errorMessage = deriveMessage(body);

    const minerKey =
      typeof body.minerKey === 'string' && body.minerKey.trim().length > 0
        ? body.minerKey.trim()
        : 'UNKNOWN_MINER_KEY';

    const walletAddress =
      typeof body.walletAddress === 'string' &&
      body.walletAddress.trim().length > 0
        ? body.walletAddress.trim()
        : 'UNKNOWN_WALLET_ADDRESS';

    const issueType =
      typeof body.issueType === 'string' && body.issueType.trim().length > 0
        ? body.issueType.trim()
        : 'CLIENT_RUNTIME_ERROR';

    const part =
      typeof body.part === 'string' && body.part.trim().length > 0
        ? body.part.trim()
        : 'client';

    const detailLines: string[] = [];
    if (body.stack) {
      detailLines.push(String(body.stack).slice(0, 4000));
    }
    if (body.source) {
      const location = `${body.source}:${body.line ?? '?'}:${body.column ?? '?'}`;
      detailLines.push(`Source: ${location}`);
    }
    if (body.url) {
      detailLines.push(`URL: ${body.url}`);
    }
    if (body.reason) {
      try {
        detailLines.push(
          'Reason: ' + JSON.stringify(body.reason, null, 2)
        );
      } catch {
        detailLines.push(`Reason: ${String(body.reason)}`);
      }
    }

    const metadata = {
      source: body.source,
      line: body.line,
      column: body.column,
      url: body.url,
      userAgent: req.headers['user-agent'],
    };

    loggers.apiError('/client/runtime', new Error(errorMessage), {
      miner_key: minerKey,
      address: walletAddress,
      issueType,
      part,
      detail: detailLines.join('\n'),
      metadata,
    });

    res.status(200).json({ success: true });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to log client error',
        'Please try again later.'
      ),
      issueType: 'CLIENT_ERROR_LOGGING_FAILURE',
      part: 'client-error.handler',
      metadata: {
        bodyType: typeof req.body,
      },
    });
  }
}
