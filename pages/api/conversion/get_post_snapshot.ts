import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { FRY_1 } from '../../../lib/utils';
import { getAlgodClient } from '../../../lib/wallet/clients';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

const ENDPOINT = '/api/conversion/get_post_snapshot';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
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
    return res.status(401).json(CommonErrors.noSession());
  }

  const { address } = (req.body ?? {}) as {
    address?: string;
  };

  if (session.user.address !== address || !address) {
    loggers.apiError(ENDPOINT, new Error('Wallet mismatch retrieving post-snapshot state'), {
      sessionAddress: session.user.address,
      address,
      issueType: 'POST_SNAPSHOT_WALLET_MISMATCH',
      part: 'post-snapshot.get.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    // 1. Get December 2024 snapshot amount from fry-conversions
    const fryConversions = db.collection('fry-conversions');
    const snapshotUser = await fryConversions.findOne({ address });
    const snapshotAmount = snapshotUser?.amount ?? 0;

    // 2. Query on-chain FRY 1.0 balance directly via Algod
    const algodClient = getAlgodClient();
    let userFry1Balance = 0;
    try {
      const accountInfo = await algodClient.accountInformation(address).do();
      const assets = (accountInfo.assets ?? []) as Array<{
        ['asset-id']?: number | string | bigint;
        assetId?: number | string | bigint;
        amount?: number | string | bigint;
      }>;
      const fry1Asset = assets.find((a) => {
        const id = a['asset-id'] ?? a.assetId ?? null;
        return String(id) === FRY_1.id;
      });
      if (fry1Asset) {
        userFry1Balance = Number(fry1Asset.amount) / Math.pow(10, FRY_1.decimals);
      }
    } catch (err) {
      console.warn('[get_post_snapshot] failed to query user FRY 1.0 balance', err);
    }

    // 3. Compute post-snapshot eligibility
    const eligible_fry1 = Math.max(0, Number((userFry1Balance - snapshotAmount).toFixed(6)));
    const eligible_tFRY = eligible_fry1 > 0 ? Number((eligible_fry1 / 40).toFixed(6)) : 0;

    // 4. Check existing post-snapshot record
    const postSnapshotCollection = db.collection('post-snapshot-conversions');
    const record = await postSnapshotCollection.findOne({ address });

    const post_snapshot = {
      eligible_fry1,
      eligible_tFRY,
      burned: record?.burned ?? false,
      claimed: record?.claimed ?? false,
      claim_txId: record?.claim_txId ?? null,
      claimed_at: record?.claimed_at ?? null,
    };

    return res.status(200).json({
      success: true,
      post_snapshot,
    });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to compute post-snapshot eligibility',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress: address,
      issueType: 'POST_SNAPSHOT_STATE_ERROR',
      part: 'post-snapshot.get.handler',
      metadata: { address },
    });
  }
}
