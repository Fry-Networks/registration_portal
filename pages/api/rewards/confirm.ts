import { NextApiRequest, NextApiResponse } from 'next';
import algosdk from 'algosdk';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { getTransactionTime } from '../../../lib/utils';
import { loadMnemonicAccountPair } from '../../../lib/algorand/admin';
import { getAlgodClient } from '../../../lib/wallet/clients';
import { getFailoverAlgodClient } from '../../../lib/algorand/failover';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/algorand/verification';
import { verifyClientToken } from '../../../lib/clientTokenMiddleware';
import { verifyRequestSignatureAsync } from '../../../lib/requestSignature.server';
import { isAdminRequest } from '../../../lib/adminCheck';
import { verifyDeviceFingerprintMiddleware } from '../../../lib/deviceFingerprint';
import { loggers } from '../../../lib/logger';
import { confirmJournalEntryByGroupId } from '../../../lib/db/requestLocks';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

// The vault-signed legs of a user-pays claim group are [reward legs (vault -> claimer), then the
// FFG holder-cut legs (vault -> sink)] — see buildUserPaysClaimGroup in lib/algorand/admin.ts.
// algod's sendRawTransaction answers with the txid of group member 0, which is the user's gas
// PAYMENT leg, not the transfer that moved the reward. The audit row must carry the leg that
// actually moved the asset, so it is recovered here from the envelope the server already holds.
// Returns undefined when nothing matches; the caller falls back rather than inventing an id.
const extractAssetTransferTxId = (
  signedServerLegsB64: string[],
  claimingAddress: string
): string | undefined => {
  for (const legB64 of signedServerLegsB64) {
    try {
      const decoded = algosdk.decodeSignedTransaction(new Uint8Array(Buffer.from(legB64, 'base64')));
      const txn = decoded.txn as any;
      if (txn?.type !== 'axfer') {
        continue;
      }
      const receiver = txn.assetTransfer?.receiver;
      if (receiver && String(receiver) === claimingAddress) {
        return txn.txID();
      }
    } catch (decodeError) {
      // A leg we cannot decode is skipped: this runs after the group already settled on chain,
      // so it must never turn a successful claim into an error.
    }
  }
  return undefined;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  if (session?.user?.address) {
    (req as NextApiRequest & { _sessionWalletAddress?: string })._sessionWalletAddress =
      session.user.address;
  }

  // Check if user is admin (bypasses all security layers)
  const isAdmin = await isAdminRequest(req, session);

  if (!isAdmin) {
    // Layer 1: Verify client token to prevent automated scripts
    const tokenVerified = await verifyClientToken(req, res);
    if (!tokenVerified) {
      return;
    }

    // Layer 2: Verify request signature to prevent body tampering
    const signature = req.headers['x-request-signature'] as string;
    const timestamp = parseInt(req.headers['x-request-timestamp'] as string, 10);

    if (!signature || !timestamp) {
      // RC5 (r12): serverTime lets a clock-skewed client correct its offset and retry once.
      res.status(403).json({
        success: false,
        code: 'MISSING_SIGNATURE',
        message: 'Request signature or timestamp missing',
        serverTime: Date.now()
      });
      return;
    }

    const signatureValid = await verifyRequestSignatureAsync(req.method || 'POST', req.url || '/api/rewards/confirm', req.body, timestamp, signature, req);
    if (!signatureValid) {
      // RC5 (r12): as in claim.ts — this return precedes every write in this handler.
      res.status(403).json({
        success: false,
        code: 'INVALID_SIGNATURE',
        message: 'Invalid request signature',
        serverTime: Date.now()
      });
      return;
    }
  }

  // Session check happens AFTER security verification
  if (!session || !session.user) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }
  const walletAddress = session.user.address;

  const { txId } = req.body as { txId: string };

  // Layer 4: Verify device fingerprint to prevent cookie replay from different devices/scripts
  // Admins can use scripts; non-admins must use same browser/device
  const fingerprintStatus = await verifyDeviceFingerprintMiddleware(req, session, isAdmin, { walletAddress: session.user.address, minerKey: 'confirm-txn' });
  if (fingerprintStatus === 'retry') {
    return res.status(409).json({
      success: false,
      code: 'DEVICE_FINGERPRINT_REFRESH',
      message: 'Security check refreshed your session. Please retry the request.'
    });
  }
  if (fingerprintStatus === 'blocked') {
    return res.status(403).json({
      success: false,
      code: 'DEVICE_MISMATCH',
      message: 'Request originated from different device or script',
      serverTime: Date.now()
    });
  }
  // User-pays-gas confirm: reassemble the user-signed payment leg with the server-signed
  // vault legs, submit the atomic group, then mark the reward rows claimed (moved here from
  // /claim for the user-pays path only). The custodial (txId) path below is unchanged.
  const { groupId, signedUserLegB64 } = req.body as { groupId?: string; signedUserLegB64?: string };
  if (groupId) {
    if (!signedUserLegB64) {
      res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Missing signed payment transaction.'));
      return;
    }
    try {
      const client = await clientPromise;
      const db = client.db('main');
      const pendingCollection = db.collection('reward_pending_claims');
      const pending = await pendingCollection.findOne({ groupId });
      if (!pending) {
        res.status(410).json(createApiError('CLAIM_GROUP_EXPIRED', 'This claim session expired. Please start the claim again.'));
        return;
      }
      if (pending.claimingAddress !== walletAddress) {
        res.status(403).json(createApiError(ErrorCodes.WALLET_MISMATCH, 'This claim belongs to a different wallet.', undefined, { serverTime: Date.now() }));
        return;
      }

      const userLegBytes = new Uint8Array(Buffer.from(signedUserLegB64, 'base64'));
      const decodedUser = algosdk.decodeSignedTransaction(userLegBytes);
      const userGroup = decodedUser.txn.group ? Buffer.from(decodedUser.txn.group).toString('base64') : '';
      // The group id binds leg0's exact fields (amount/receiver/type) to the server legs, so a
      // matching group id proves the user signed the exact payment leg we built. algod also
      // rejects the group on any mismatch, so this is a fast-fail guard, not the only enforcement.
      if (userGroup !== groupId) {
        res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Signed payment does not match the claim group.'));
        return;
      }

      const signedGroup = [
        userLegBytes,
        ...(pending.signedServerLegsB64 as string[]).map((b) => new Uint8Array(Buffer.from(b, 'base64')))
      ];
      const algod = (await getFailoverAlgodClient()) as ReturnType<typeof getAlgodClient>;
      const { txid } = await algod.sendRawTransaction(signedGroup).do();
      await algosdk.waitForConfirmation(algod, txid, 6);

      // Moved claimed-write (user-pays only). Idempotent via the status:claimable arrayFilter.
      const rewardsCollection = db.collection('device-rewards');
      const minerKey = pending.miner_key as string;
      const records = (pending.records || []) as Array<{ source: string; reward_number: number; amount: number }>;
      const weeklyNos = records.filter((r) => r.source === 'weekly').map((r) => r.reward_number);
      const dailyNos = records.filter((r) => r.source === 'daily').map((r) => r.reward_number);
      const claimedAt = new Date();
      if (weeklyNos.length) {
        await rewardsCollection.updateOne(
          { miner_key: minerKey },
          { $set: { 'weekly_rewards.$[elem].status': 'claimed', 'weekly_rewards.$[elem].tx_id': txid, 'weekly_rewards.$[elem].claimed_at': claimedAt } },
          { arrayFilters: [{ 'elem.reward_number': { $in: weeklyNos }, 'elem.status': { $in: ['claimable', 'claiming'] } }] }
        );
      }
      if (dailyNos.length) {
        await rewardsCollection.updateOne(
          { miner_key: minerKey },
          { $set: { 'daily_rewards.$[elem].status': 'claimed', 'daily_rewards.$[elem].tx_id': txid, 'daily_rewards.$[elem].claimed_at': claimedAt } },
          { arrayFilters: [{ 'elem.reward_number': { $in: dailyNos }, 'elem.status': { $in: ['claimable', 'claiming'] } }] }
        );
      }
      for (const r of records) {
        const arr = r.source === 'weekly' ? 'weekly_rewards' : 'daily_rewards';
        await rewardsCollection.updateOne(
          { miner_key: minerKey },
          { $set: { [`${arr}.$[elem].claimed_amount`]: r.amount } },
          { arrayFilters: [{ 'elem.reward_number': r.reward_number, 'elem.status': 'claimed', 'elem.tx_id': txid }] }
        );
      }
      await pendingCollection.deleteOne({ groupId });

      // Close the audit row (main.device_transactions). /claim mints it `pending` because the
      // envelope is only pre-signed there; this is the first point at which the claim is genuinely
      // settled, and until now nothing ever came back to it. Forward-only: the helper moves a
      // pending/submitted row and nothing else, and a failure here is logged, never retried — the
      // payment is already on chain and must not resurface to the user as an error.
      const assetTransferTxId = extractAssetTransferTxId(
        (pending.signedServerLegsB64 as string[]) || [],
        walletAddress
      );
      try {
        await confirmJournalEntryByGroupId({
          miner_key: minerKey,
          groupId,
          txId: assetTransferTxId ?? txid
        });
      } catch (journalError) {
        loggers.apiError(
          '/api/rewards/confirm',
          journalError instanceof Error ? journalError : new Error(String(journalError)),
          {
            miner_key: minerKey,
            address: walletAddress,
            issueType: 'REWARD_CONFIRM_JOURNAL_WRITEBACK_FAILED',
            part: 'rewards-confirm.userpays.journal',
            metadata: { groupId }
          }
        );
      }

      loggers.txnLog('reward_claim_userpays_confirmed', txid, { address: walletAddress, claimedAt });
      res.status(200).json({ ok: true, success: true, txId: txid, claimedAt });
      return;
    } catch (error) {
      handleApiError(res, '/api/rewards/confirm', error, {
        response: createApiError(ErrorCodes.INTERNAL_ERROR, 'Unable to submit the claim group.', 'Please try again shortly.'),
        walletAddress,
        issueType: 'REWARD_USERPAYS_CONFIRM_ERROR',
        part: 'rewards-confirm.userpays',
        metadata: { address: walletAddress, groupId },
      });
      return;
    }
  }

  if (!txId) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'A transaction ID is required for confirmation',
        'Please retry after submitting your claim transaction.'
      )
    );
    return;
  }

  try {
    // Verify against the sender vault address
    const { address: vaultAddress } = loadMnemonicAccountPair({
      mnemonicEnv: 'REWARD_MNEMONIC',
      label: 'reward sender'
    });
    const result = await verifyTransaction(vaultAddress, txId);
    if (result !== VERIFY_RESULT.OK) {
      // not confirmed yet
      res.status(200).json({ success: false, code: 'NETWORK_ERROR', message: 'Not yet confirmed' });
      return;
    }

    // Get exact on-chain timestamp
    const claimedAt = await getTransactionTime(txId);

    const client = await clientPromise;
    const db = client.db('main');
    // Update device-rewards entries (weekly and daily) with chain timestamp
    const weeklyCollection = db.collection('device-rewards');
    await weeklyCollection.updateMany(
      { 'weekly_rewards.tx_id': txId },
      { $set: { 'weekly_rewards.$[elem].claimed_at': claimedAt } },
      { arrayFilters: [{ 'elem.tx_id': txId }] }
    );
    await weeklyCollection.updateMany(
      { 'daily_rewards.tx_id': txId },
      { $set: { 'daily_rewards.$[elem].claimed_at': claimedAt } },
      { arrayFilters: [{ 'elem.tx_id': txId }] }
    );


    loggers.txnLog('reward_claim_confirmed', txId, {
      address: walletAddress,
      claimedAt,
    });

    res.status(200).json({ success: true, claimedAt });
  } catch (error) {
    handleApiError(res, '/api/rewards/confirm', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to confirm the claim transaction',
        'Please try again shortly.'
      ),
      walletAddress,
      issueType: 'REWARD_CONFIRM_ERROR',
      part: 'rewards-confirm.handler',
      metadata: {
        address: walletAddress,
        txId,
      },
    });
  }
}
