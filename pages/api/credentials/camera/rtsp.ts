// pages/api/credentials/camera/rtsp.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import * as url from 'url';
import checkRtspLink, { RtspCheckResult } from '../../../../lib/rtspCheck';
import clientPromise from '../../../../lib/mongoclient';
import { rateLimitMiddleware } from '../../../../lib/ratelimit';
import { loggers } from '../../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../../lib/api-errors';

// Using shared lib: checkRtspLink

const validateRtsp = async (params: {
  req: NextApiRequest;
  res: NextApiResponse;
  credentials: Record<string, any>;
}) => {
  const { req, res, credentials } = params;

  const rtspUrl = (credentials && credentials.rtsp_url) || '';
  if (!rtspUrl || typeof rtspUrl !== 'string') {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'RTSP URL is required',
        'Please provide the RTSP URL and try again.'
      )
    );
    return;
  }

  try {
    const parsed = url.parse(rtspUrl as string);
    if (!parsed.hostname) {
      res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Invalid RTSP URL — hostname is missing',
          'Please double-check the address and include the full host.'
        )
      );
      return;
    }
  } catch (e) {
    // continue; checkRtspLink will report parse errors if present
  }

  try {
    // Before attempting network validation, ensure the RTSP URL isn't already
    // registered to a different miner_key in the creds.camera collection.
    try {
      const client = await clientPromise;
      const db = client.db(process.env.MONGO_CREDS_DB || 'creds');
      const collName = process.env.MONGO_CREDS_COLLECTION || 'camera';
      const coll = db.collection(collName);
      // Look for an existing entry with this rtsp_url
      const existing = await coll.findOne({ rtsp_url: rtspUrl });
      const submittedMinerKey = credentials?.miner_key;
      if (existing) {
        // If the existing doc has a different miner_key, reject the validation
        const existingKey = existing.miner_key || null;
        if (!submittedMinerKey || String(existingKey) !== String(submittedMinerKey)) {
          res.status(400).json(
            createApiError(
              ErrorCodes.INVALID_INPUT,
              'RTSP URL already registered',
              'Please unlink the credential from the other device before proceeding.',
              { details: 'This RTSP URL is already registered to another miner_key.' }
            )
          );
          return;
        }
        // If the miner_key matches, continue — allow re-validation for the same miner.
      }
    } catch (mongoErr: any) {
      loggers.apiError('/api/credentials/camera/rtsp', mongoErr, {
        miner_key: credentials?.miner_key,
        issueType: 'RTSP_DB_LOOKUP_ERROR',
        part: 'credentials.camera.rtsp.uniqueness',
      });
      // Fall through to network validation; we don't want DB errors to block validation entirely
    }

    const result: RtspCheckResult = await checkRtspLink(rtspUrl);
    if (!result.ok) {
      // map specific codes to friendly responses
      if (result.code === 'PRIVATE_IP') {
        res.status(400).json(
          createApiError(
            ErrorCodes.INVALID_INPUT,
            'RTSP URL resolves to a private/local IP',
            'Use a public IP address and ensure port forwarding is configured.'
          )
        );
        return;
      }

      if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE', 'ECONNRESET', 'CLOSED'].includes(result.code || '')) {
        const host = result.host || 'host';
        const port = result.port || 554;
        res.status(400).json(
          createApiError(
            ErrorCodes.INVALID_INPUT,
            'RTSP connection failed — host reachable but port is closed or not forwarded',
            'Ensure the device is accessible via its public IP and that the RTSP port is forwarded/unblocked.',
            { host, port }
          )
        );
        return;
      }

      // fallback: return the message/code for debugging
      res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'RTSP validation failed',
          'Please verify the RTSP stream details and try again.',
          { details: result.message || result.code }
        )
      );
      return;
    }
  } catch (err: any) {
    const code = err?.code || '';
    // Common network codes when the host is reachable but the port is closed/unforwarded
    if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE', 'ECONNRESET'].includes(code)) {
      const parsed = url.parse(rtspUrl as string);
      const host = parsed.hostname || 'host';
      const port = parsed.port || '554';
      res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'RTSP connection failed — host reachable but port is closed or not forwarded',
          'Ensure the device is accessible via its public IP and that the RTSP port is forwarded/unblocked.',
          { host, port }
        )
      );
      return;
    }

    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'RTSP validation failed',
        'Please verify the RTSP stream details and try again.',
        { details: String(err?.message || err) }
      )
    );
    return;
  }

  res.status(200).json({ message: 'Validation successful' });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anon';
  const allowed = rateLimitMiddleware(String(ip));
  if (!allowed(req, res)) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    loggers.apiError('/api/credentials/camera/rtsp', new Error('Unauthenticated RTSP validation request'), {
      hasCookie: Boolean(req.headers?.cookie),
      issueType: 'RTSP_VALIDATION_UNAUTHENTICATED',
      part: 'credentials.camera.rtsp.auth',
    });
    return res.status(401).json(CommonErrors.noSession());
  }

  const { credentials } = req.body;
  if (!credentials) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing credentials payload',
        'Please provide the RTSP credentials and try again.'
      )
    );
  }

  try {
    await validateRtsp({ req, res, credentials });
  } catch (error) {
    const minerKey = credentials?.miner_key;
    handleApiError(res, '/api/credentials/camera/rtsp', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to validate RTSP credentials',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey,
      walletAddress: session.user.address,
      issueType: 'RTSP_VALIDATION_ERROR',
      part: 'credentials.camera.rtsp.handler',
      metadata: {
        miner_key: minerKey,
        address: session.user.address,
      },
    });
  }
}
