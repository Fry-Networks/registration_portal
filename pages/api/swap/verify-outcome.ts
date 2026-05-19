/**
 * POST /api/swap/verify-outcome
 *
 * Server-side authoritative outcome verification + automatic settlement trigger.
 * Client txids are UNTRUSTED inputs. Only inner axfers from confirmed swap group
 * are authoritative evidence.
 *
 * After verification, if shortfall > 0 and guarantee eligible, triggers settlement.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { isInstrumentationEnabled } from '../../../lib/swap/guaranteeInstrumentation';
import {
  getCommitmentByQuoteId,
  getOutcomeByQuoteId,
  updateOutcomeVerification,
  updateOutcomeSettlement,
  type InnerTxnEvidence,
} from '../../../lib/swap/guaranteeStore';
import { getIndexerClient } from '../../../lib/wallet/clients';
import { withAlgorandRetry } from '../../../lib/algorand/withRetry';
import { isGuaranteeEnabled, isGuaranteePaused } from '../../../lib/swap/guaranteeConfig';
import { executeSettlement } from '../../../lib/swap/guaranteeSettlement';
import {
  getMaxTopupPerSwap,
  getMaxTopupPerWalletDay,
  getMaxTopupGlobalDay,
} from '../../../lib/swap/guaranteeConfig';
import { getDailyWalletTopup, getDailyGlobalTopup, getUtcDayBounds } from '../../../lib/swap/guaranteeStore';

interface IndexerTxn {
  txType?: string;
  sender?: string;
  confirmedRound?: number | bigint;
  group?: Uint8Array | string;
  id?: string;
  innerTxns?: IndexerTxn[];
  assetTransferTransaction?: {
    receiver?: string;
    amount?: number | bigint;
    assetId?: number | bigint;
  };
  applicationTransaction?: {
    applicationId?: number | bigint;
  };
}

function groupToBase64(group: Uint8Array | string | undefined): string | null {
  if (!group) return null;
  if (typeof group === 'string') return group;
  if (group instanceof Uint8Array) return Buffer.from(group).toString('base64');
  return null;
}

function collectInnerAxfers(
  txns: IndexerTxn[],
  targetReceiver: string,
  targetAssetId: number,
  parentTxId: string,
  confirmedRound: number,
  seen: Set<string>
): InnerTxnEvidence[] {
  const results: InnerTxnEvidence[] = [];
  for (const inner of txns) {
    if (inner.txType === 'axfer') {
      const at = inner.assetTransferTransaction;
      if (
        at &&
        at.receiver === targetReceiver &&
        Number(at.assetId) === targetAssetId &&
        (typeof at.amount === 'number' || typeof at.amount === 'bigint')
      ) {
        const amount = Number(at.amount);
        const dedupeKey = `${parentTxId}:${at.receiver}:${amount}:${Number(at.assetId)}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          results.push({
            txId: parentTxId,
            type: 'axfer',
            assetId: Number(at.assetId),
            amount,
            receiver: at.receiver,
            confirmedRound,
          });
        }
      }
    }
    if (inner.innerTxns && inner.innerTxns.length > 0) {
      results.push(
        ...collectInnerAxfers(inner.innerTxns, targetReceiver, targetAssetId, parentTxId, confirmedRound, seen)
      );
    }
  }
  return results;
}

/**
 * Attempt settlement inline after successful verification.
 * Fire-and-forget — settlement failures don't break the verification response.
 */
async function trySettlement(quoteId: string, commitment: any, authoritativeReceived: number): Promise<{
  settled: boolean;
  txId?: string;
  shortfall?: number;
  reason?: string;
}> {
  try {
    if (!isGuaranteeEnabled() || isGuaranteePaused() || !commitment.guaranteeEligible) {
      return { settled: false, reason: 'not_eligible' };
    }

    const guaranteed = commitment.guaranteedAmount || 0;
    const shortfall = Math.max(0, guaranteed - authoritativeReceived);
    if (shortfall === 0) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'skipped', settlementAmount: 0 });
      return { settled: false, reason: 'no_shortfall', shortfall: 0 };
    }

    // Settlement deadline
    if (Date.now() > commitment.settlementDeadline) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'failed', settlementError: 'expired' });
      return { settled: false, reason: 'settlement_expired' };
    }

    // Cap checks
    if (BigInt(shortfall) > getMaxTopupPerSwap()) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'failed', settlementError: 'per_swap_cap' });
      return { settled: false, reason: 'per_swap_cap' };
    }
    const { start, end } = getUtcDayBounds();
    const [wd, gd] = await Promise.all([
      getDailyWalletTopup(commitment.userAddress, start, end),
      getDailyGlobalTopup(start, end),
    ]);
    if (BigInt(wd) + BigInt(shortfall) > getMaxTopupPerWalletDay()) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'failed', settlementError: 'wallet_daily_cap' });
      return { settled: false, reason: 'wallet_daily_cap' };
    }
    if (BigInt(gd) + BigInt(shortfall) > getMaxTopupGlobalDay()) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'failed', settlementError: 'global_daily_cap' });
      return { settled: false, reason: 'global_daily_cap' };
    }

    await updateOutcomeSettlement(quoteId, { settlementStatus: 'pending' });
    const result = await executeSettlement({
      quoteId,
      walletAddress: commitment.userAddress,
      targetAssetId: commitment.outputAsset,
      guaranteedAmount: guaranteed,
      settlementDeadline: commitment.settlementDeadline,
      shortfallAmount: shortfall,
    });
    await updateOutcomeSettlement(quoteId, {
      settlementStatus: 'settled',
      settlementTxId: result.txId,
      settlementAmount: shortfall,
      settlementTimestamp: Date.now(),
    });
    return { settled: true, txId: result.txId, shortfall };
  } catch (err) {
    console.error('[verify-outcome] settlement failed:', err);
    try {
      await updateOutcomeSettlement(quoteId, {
        settlementStatus: 'failed',
        settlementError: err instanceof Error ? err.message : 'unknown',
      });
    } catch { /* best effort */ }
    return { settled: false, reason: 'settlement_error' };
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!isInstrumentationEnabled() && !isGuaranteeEnabled()) {
    return res.status(200).json({ success: true, verified: false, reason: 'disabled' });
  }

  const { quoteId } = req.body;
  if (!quoteId || typeof quoteId !== 'string') {
    return res.status(400).json({ success: false, error: 'quoteId required' });
  }

  try {
    const commitment = await getCommitmentByQuoteId(quoteId);
    if (!commitment) {
      return res.status(404).json({ success: false, error: 'commitment_not_found' });
    }

    const outcome = await getOutcomeByQuoteId(quoteId);
    if (!outcome) {
      return res.status(404).json({ success: false, error: 'outcome_not_found' });
    }

    if (outcome.verificationStatus === 'verified' || outcome.verificationStatus === 'discrepancy') {
      return res.status(200).json({ success: true, verified: true, reason: 'already_verified' });
    }

    const attempts = (outcome.verificationAttempts || 0) + 1;
    const { userAddress, outputAsset, guaranteedAmount } = commitment;

    const uniqueTxIds = Array.from(new Set(outcome.swapTxnIds));
    if (uniqueTxIds.length === 0) {
      await updateOutcomeVerification(quoteId, {
        verificationStatus: 'failed',
        verificationError: 'no_txids',
        verificationAttempts: attempts,
        verificationTimestamp: Date.now(),
      });
      return res.status(200).json({ success: true, verified: false, reason: 'no_txids' });
    }

    const indexer = getIndexerClient();
    const loadedTxns: Array<{ txId: string; txn: IndexerTxn }> = [];
    const groups = new Set<string>();
    let hasApplWithInnerTxns = false;

    for (const txId of uniqueTxIds) {
      try {
        const result = await withAlgorandRetry(indexer.lookupTransactionByID(txId));
        const txn = (result as any).transaction as IndexerTxn;
        if (!txn || !txn.confirmedRound) continue;
        const groupB64 = groupToBase64(txn.group);
        if (groupB64) groups.add(groupB64);
        if (txn.txType === 'appl' && txn.innerTxns && txn.innerTxns.length > 0) {
          hasApplWithInnerTxns = true;
        }
        loadedTxns.push({ txId, txn });
      } catch (err) {
        console.error(`[verify-outcome] Failed to load txId ${txId}:`, err);
      }
    }

    if (loadedTxns.length === 0) {
      await updateOutcomeVerification(quoteId, {
        verificationStatus: 'failed',
        verificationError: 'no_confirmed_txns_found',
        verificationAttempts: attempts,
        verificationTimestamp: Date.now(),
      });
      return res.status(200).json({ success: true, verified: false, reason: 'no_confirmed_txns_found' });
    }

    if (groups.size > 1) {
      await updateOutcomeVerification(quoteId, {
        verificationStatus: 'failed',
        verificationError: 'multiple_groups_detected',
        verificationAttempts: attempts,
        verificationTimestamp: Date.now(),
      });
      return res.status(200).json({ success: true, verified: false, reason: 'multiple_groups' });
    }

    // ── Group discovery: if client reported a non-appl txn in an atomic group,
    // fetch the full group from the indexer so we can find the app call with
    // inner axfers.  This handles aggregator-routed swaps where the client
    // sends the payment txid instead of the app-call txid.
    if (!hasApplWithInnerTxns && groups.size === 1) {
      const groupB64 = Array.from(groups)[0];
      try {
        const groupResult = await withAlgorandRetry(
          indexer.searchForTransactions().groupid(groupB64)
        );
        const groupTxns = ((groupResult as any).transactions || []) as IndexerTxn[];
        console.log(
          `[verify-outcome] group discovery: group=${groupB64}, found=${groupTxns.length}`
        );
        for (const txn of groupTxns) {
          if (!txn || !txn.confirmedRound) continue;
          if (txn.id && !loadedTxns.some((lt) => lt.txId === txn.id)) {
            loadedTxns.push({ txId: txn.id, txn });
          }
          if (txn.txType === 'appl' && txn.innerTxns && txn.innerTxns.length > 0) {
            hasApplWithInnerTxns = true;
          }
        }
      } catch (err) {
        console.error(`[verify-outcome] group discovery failed:`, err);
      }
    }

    if (!hasApplWithInnerTxns) {
      // If we know there was a group but the app call hasn't appeared yet,
      // the indexer may still be catching up — return pending so the caller retries.
      if (groups.size === 1) {
        await updateOutcomeVerification(quoteId, {
          verificationStatus: 'pending',
          verificationError: 'group_txns_still_indexing',
          verificationAttempts: attempts,
          verificationTimestamp: Date.now(),
        });
        return res.status(200).json({
          success: true,
          verified: false,
          reason: 'group_txns_still_indexing',
        });
      }

      await updateOutcomeVerification(quoteId, {
        verificationStatus: 'failed',
        verificationError: 'no_appl_with_inner_txns_in_group',
        verificationAttempts: attempts,
        verificationTimestamp: Date.now(),
      });
      return res.status(200).json({ success: true, verified: false, reason: 'no_swap_context' });
    }

    const seen = new Set<string>();
    const allEvidence: InnerTxnEvidence[] = [];
    for (const { txId, txn } of loadedTxns) {
      if (txn.txType === 'appl' && txn.innerTxns) {
        allEvidence.push(
          ...collectInnerAxfers(txn.innerTxns, userAddress, outputAsset, txId, Number(txn.confirmedRound), seen)
        );
      }
    }

    if (allEvidence.length === 0) {
      await updateOutcomeVerification(quoteId, {
        verificationStatus: 'failed',
        verificationError: 'no_matching_inner_axfer',
        verificationAttempts: attempts,
        verificationTimestamp: Date.now(),
      });
      return res.status(200).json({ success: true, verified: false, reason: 'no_matching_inner_axfer' });
    }

    const authoritativeReceived = allEvidence.reduce((sum, e) => sum + e.amount, 0);
    const authoritativeShortfall = Math.max(0, guaranteedAmount - authoritativeReceived);
    const clientReportedReceived = outcome.clientReportedReceived || 0;
    const discrepancyAmount = Math.abs(authoritativeReceived - clientReportedReceived);
    const discrepancyFlag = discrepancyAmount > 0;
    const verificationStatus = discrepancyFlag ? 'discrepancy' as const : 'verified' as const;

    await updateOutcomeVerification(quoteId, {
      verificationStatus,
      authoritativeReceived,
      authoritativeShortfall,
      verificationSource: 'indexer_lookup_by_id',
      verificationTimestamp: Date.now(),
      verificationAttempts: attempts,
      discrepancyAmount,
      discrepancyFlag,
      innerTxnEvidence: allEvidence,
    });

    // Auto-trigger settlement if shortfall detected and guarantee eligible
    let settlement: Record<string, unknown> | undefined;
    if (authoritativeShortfall > 0 && commitment.guaranteeEligible) {
      const sResult = await trySettlement(quoteId, commitment, authoritativeReceived);
      settlement = sResult;
    } else if (authoritativeShortfall === 0) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'skipped', settlementAmount: 0 });
    }

    return res.status(200).json({
      success: true,
      verified: true,
      verificationStatus,
      authoritativeReceived,
      authoritativeShortfall,
      discrepancyFlag,
      discrepancyAmount,
      evidenceCount: allEvidence.length,
      ...(settlement ? { settlement } : {}),
    });
  } catch (err: any) {
    console.error('[swap/verify-outcome]', err);
    try {
      const outcome = await getOutcomeByQuoteId(quoteId);
      if (outcome) {
        await updateOutcomeVerification(quoteId, {
          verificationStatus: 'failed',
          verificationError: err.message || 'verification_error',
          verificationAttempts: (outcome.verificationAttempts || 0) + 1,
          verificationTimestamp: Date.now(),
        });
      }
    } catch { /* best effort */ }
    return res.status(500).json({ success: false, error: 'Verification failed' });
  }
}
