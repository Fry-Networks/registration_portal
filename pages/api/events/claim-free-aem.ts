import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { generateMinerKey } from '../../../lib/minerKey';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res
      .status(405)
      .json(createApiError(ErrorCodes.INVALID_INPUT, 'Only POST is allowed.'));
  }

  try {
    const security = await enforceWalletApiSecurity(req, res, {
      endpoint: '/api/events/claim-free-aem'
    });
    if (!security) return;

    const userAddress = security.session.user.address;
    const client = await clientPromise;
    const db = client.db('main');
    const devicesCollection = db.collection('devices');

    const existing = await devicesCollection.findOne({
      address: userAddress,
      miner_key: { $regex: /^AEM/ },
      source: 'event-free-aem'
    });

    if (existing) {
      return res.status(200).json({
        alreadyClaimed: true,
        minerKey: existing.miner_key,
        minerKeyChecksum: existing.miner_key.slice(0, 3)
      });
    }

    await withDeviceActionLock(
      req,
      res,
      {
        miner_key: `event-free-aem:${userAddress}`,
        address: userAddress,
        action: 'event:claim-free-aem',
        metadata: { eventId: '6a171bccca0587d3198ce5b0' }
      },
      async () => {
        let minerKey = generateMinerKey('AEM');
        let attempts = 0;
        while (attempts < 5 && (await devicesCollection.findOne({ miner_key: minerKey }))) {
          minerKey = generateMinerKey('AEM');
          attempts += 1;
        }

        if (await devicesCollection.findOne({ miner_key: minerKey })) {
          throw {
            status: 500,
            response: createApiError(
              ErrorCodes.INTERNAL_ERROR,
              'Unable to allocate a miner key right now',
              'Please retry shortly.'
            )
          };
        }

        const now = new Date();
        await devicesCollection.insertOne({
          miner_key: minerKey,
          created_at: now,
          name: '$FRY AI Edge Miner',
          is_registered: false,
          address: userAddress,
          source: 'event-free-aem'
        });

        return {
          response: {
            minerKey,
            minerKeyChecksum: minerKey.slice(0, 3)
          }
        };
      }
    );
  } catch (error) {
    return handleApiError(res, '/api/events/claim-free-aem', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to issue your free AEM key',
        'Please retry in a moment.'
      ),
      issueType: 'EVENT_FREE_AEM_CLAIM_ERROR',
      part: 'events.claim-free-aem.handler'
    });
  }
}
