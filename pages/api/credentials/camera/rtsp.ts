// pages/api/credentials/camera/rtsp.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../auth/[...nextauth]';

const validateRtsp = async (params: {
  req: NextApiRequest;
  res: NextApiResponse;
  credentials: Record<string, any>;
}) => {
  const { req, res, credentials } = params;
  
  const { url, username, password } = credentials ?? {};
  if (!url) {
    res.status(400).json({ message: 'Missing RTSP URL' });
    return;
  }

  const baseUrl =
    process.env.NEXTAUTH_URL ||
    `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;

  const rtspRes = await fetch(`${baseUrl}/api/rtsp/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, username, password }),
  });

  if (!rtspRes.ok) {
    const details = await rtspRes.json().catch(() => ({}));
    res.status(400).json({ message: 'RTSP validation failed', details });
    return;
  }

  res.status(200).json({ message: 'Validation successful' });
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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
    await validateRtsp({
      req,
      res,
      credentials,
    });
  } catch (err) {
    console.error('RTSP validation error:', err);
    return res.status(500).json({ message: 'Internal server error' });
  }
}