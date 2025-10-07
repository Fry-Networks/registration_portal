// pages/api/credentials/camera/rtsp.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';
import * as url from 'url';
import checkRtspLink, { RtspCheckResult } from '../../../../lib/rtspCheck';
import clientPromise from '../../../../lib/mongoclient';
import { rateLimitMiddleware } from '../../../../lib/ratelimit';

// Using shared lib: checkRtspLink

const validateRtsp = async (params: {
  req: NextApiRequest;
  res: NextApiResponse;
  credentials: Record<string, any>;
}) => {
  const { req, res, credentials } = params;

  const rtspUrl = (credentials && credentials.rtsp_url) || '';
  if (!rtspUrl || typeof rtspUrl !== 'string') {
    res.status(400).json({ message: 'Missing RTSP URL' });
    return;
  }

  try {
    const parsed = url.parse(rtspUrl as string);
    if (!parsed.hostname) {
      res.status(400).json({ message: 'Invalid RTSP URL; missing hostname' });
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
          res.status(400).json({ message: 'RTSP URL already registered', details: 'This RTSP URL is already registered to another miner_key.' });
          return;
        }
        // If the miner_key matches, continue — allow re-validation for the same miner.
      }
    } catch (mongoErr: any) {
      console.warn('creds DB check failed, continuing with network validation', String(mongoErr?.message || mongoErr));
      // Fall through to network validation; we don't want DB errors to block validation entirely
    }

    const result: RtspCheckResult = await checkRtspLink(rtspUrl);
    if (!result.ok) {
      // map specific codes to friendly responses
      if (result.code === 'PRIVATE_IP') {
        res.status(400).json({ message: 'RTSP URL resolves to a private/local IP; use a public IP and ensure port forwarding.' });
        return;
      }

      if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE', 'ECONNRESET', 'CLOSED'].includes(result.code || '')) {
        const host = result.host || 'host';
        const port = result.port || 554;
        res.status(400).json({
          message: 'RTSP connection failed — host reachable but port is closed or not forwarded',
          details: `Unable to connect to ${host}:${port}. Ensure the device is accessible via its public IP and that port ${port} is forwarded/unblocked.`,
        });
        return;
      }

      // fallback: return the message/code for debugging
      res.status(400).json({ message: 'RTSP validation failed', details: result.message || result.code });
      return;
    }
  } catch (err: any) {
    const code = err?.code || '';
    // Common network codes when the host is reachable but the port is closed/unforwarded
    if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EPIPE', 'ECONNRESET'].includes(code)) {
      const parsed = url.parse(rtspUrl as string);
      const host = parsed.hostname || 'host';
      const port = parsed.port || '554';
      res.status(400).json({
        message: 'RTSP connection failed — host reachable but port is closed or not forwarded',
        details: `Unable to connect to ${host}:${port}. Ensure the device is accessible via its public IP and that port ${port} is forwarded/unblocked.`,
      });
      return;
    }

    res.status(400).json({ message: 'RTSP validation failed', details: String(err?.message || err) });
    return;
  }

  res.status(200).json({ message: 'Validation successful' });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const ip = req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'anon';
  const allowed = rateLimitMiddleware(String(ip));
  if (!allowed(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!session) {
    console.warn('[credentials/camera/rtsp] no session for request, headers:', req.headers?.cookie ? 'has-cookie' : 'no-cookie');
    return res.status(401).json({ message: 'Unauthorized' });
  }

  const { credentials } = req.body;
  if (!credentials) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    await validateRtsp({ req, res, credentials });
  } catch (err) {
    console.error('RTSP validation error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}