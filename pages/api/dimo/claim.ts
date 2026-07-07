import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { enforceWalletApiSecurity } from '../../../lib/api/enforceWalletSecurity';
import { createApiError, ErrorCodes, handleApiError } from '../../../lib/api-errors';
import { withDeviceActionLock } from '../../../lib/api/deviceAction';
import { findSubscriptionById, markSubscriptionClaimed } from '../../../lib/dimo/store';
import { getDimoConfig, hashDimoId } from '../../../lib/dimo/config';
import { generateMinerKey } from '../../../lib/minerKey';
import { getConfigFlag } from '../../../lib/config';

const MINER_PREFIX = process.env.DIMO_MINER_PREFIX || 'FEM';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res
      .status(405)
      .json(createApiError(ErrorCodes.INVALID_INPUT, 'Only POST is allowed for DIMO claims.'));
  }

  try {
    // Protect claim issuance behind the same toggle used by the UI.
    const dimoEnabled = await getConfigFlag('dimo_enabled', true);
    if (!dimoEnabled) {
      return res.status(403).json(
        createApiError(
          ErrorCodes.FORBIDDEN,
          'DIMO claims are disabled right now',
          'Please try again after the launch announcement.'
        )
      );
    }

    const security = await enforceWalletApiSecurity(req, res, {
      endpoint: '/api/dimo/claim'
    });
    if (!security) return;

    const { subscriptionId } = req.body ?? {};
    if (!subscriptionId || typeof subscriptionId !== 'string') {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Missing subscription id',
          'Please select a DIMO subscription to claim against.'
        )
      );
    }

    const subscription = await findSubscriptionById(security.session.user.address, subscriptionId);
    if (!subscription) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.DEVICE_NOT_FOUND,
          'No DIMO subscription found for this wallet',
          'Please re-login with DIMO and try again.'
        )
      );
    }

    if (!subscription.eligible) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'This subscription is not eligible',
          'Check the plan and start date requirements.'
        )
      );
    }

    if (subscription.claimed_at || subscription.miner_key_hash) {
      return res.status(200).json({
        alreadyClaimed: true,
        minerKeyChecksum: subscription.miner_key_checksum
      });
    }

    const config = getDimoConfig();
    if (subscription.updated_at) {
      const updatedAt = new Date(subscription.updated_at);
      const isFresh = !Number.isNaN(updatedAt.valueOf()) && Date.now() - updatedAt.getTime() <= config.snapshotTtlMs;
      if (!isFresh) {
        return res.status(409).json(
          createApiError(
            ErrorCodes.OPERATION_IN_PROGRESS,
            'Your DIMO snapshot is stale',
            'Please refresh your DIMO connection and try again.'
          )
        );
      }
    }

    const testMode =
      process.env.NEXT_PUBLIC_TEST_MODE &&
      process.env.NEXT_PUBLIC_TEST_MODE === 'true';

    await withDeviceActionLock(
      req,
      res,
      {
        miner_key: `dimo:${subscriptionId}`,
        address: security.session.user.address,
        action: 'dimo:claim',
        metadata: { subscriptionId }
      },
      async () => {
        const client = await clientPromise;
        const db = client.db('main');
        const devicesCollection = db.collection(testMode ? 'test-devices' : 'devices');

        // Generate a miner key and collision check against existing devices.
        let minerKey = generateMinerKey(MINER_PREFIX);
        let attempts = 0;
        // Limit retries to avoid tight loops if something is seriously wrong.
        while (attempts < 5 && (await devicesCollection.findOne({ miner_key: minerKey }))) {
          minerKey = generateMinerKey(MINER_PREFIX);
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
        const resolvedEmail = security.session.user.email ?? subscription.dimo_email ?? undefined;

        await devicesCollection.insertOne({
          miner_key: minerKey,
          created_at: now,
          name: '$FRY Fry Edge Miner',
          is_registered: false,
          address: security.session.user.address,
          email: resolvedEmail,
          order: `DIMO${security.session.user.address.slice(0, 4)}`
        });

        const minerKeyHash = hashDimoId(minerKey, config.hashSecret);
        const minerKeyChecksum = minerKey.slice(0, 3);

        await markSubscriptionClaimed({
          walletAddress: security.session.user.address,
          subscriptionId,
          minerKeyHash,
          minerKeyChecksum
        });

        return {
          response: {
            minerKey,
            minerKeyChecksum
          }
        };
      }
    );
  } catch (error) {
    return handleApiError(res, '/api/dimo/claim', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to issue your AEM key',
        'Please retry in a moment.'
      ),
      issueType: 'DIMO_CLAIM_ERROR',
      part: 'dimo.claim.handler'
    });
  }
}

