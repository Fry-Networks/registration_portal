/**
 * Store device fingerprint after successful authentication
 * 
 * Call this endpoint after NextAuth login to capture the browser's device fingerprint.
 * This prevents scripts from reusing the session cookie with a different device.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from './[...nextauth]';
import { generateDeviceFingerprint } from '../../../lib/deviceFingerprint';
import clientPromise from '../../../lib/mongoclient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check session
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Generate fingerprint from this request (browser headers)
    const fingerprint = generateDeviceFingerprint(req);

    // Store in session
    (session as any).deviceFingerprint = fingerprint;

    // Also store in database for reference
    const client = await clientPromise;
    const db = client.db('main');
    
    await db.collection('registration-users').updateOne(
      { address: session.user.address },
      {
        $set: {
          last_device_fingerprint: fingerprint,
          last_fingerprint_updated: new Date()
        }
      }
    );

    return res.status(200).json({
      success: true,
      message: 'Device fingerprint captured',
      fingerprint: fingerprint.substring(0, 16) + '...'
    });
  } catch (error) {
    console.error('[captureFingerprint] Error:', error);
    return res.status(500).json({ error: 'Failed to capture fingerprint' });
  }
}
