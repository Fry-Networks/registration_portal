/**
 * POST /api/swap/verify-outcome
 *
 * Server-side authoritative outcome verification. Queries the Algorand indexer
 * for confirmed swap transactions, validates swap-group context, and parses
 * inner transactions to derive the authoritative received amount.
 *
 * Client-supplied txids are UNTRUSTED inputs. Only inner axfers from the
 * confirmed swap group are treated as authoritative evidence.
 *
 * No payout logic. No treasury signing. No user-facing guarantee claims.
 * Foreground, retryable, idempotent.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { isInstrumentationEnabled } from '../../../lib/swap/guaranteeInstrumentation';
import {
  getCommitmentByQuoteId,
  getOutcomeByQuoteId,
  updateOutcomeVerification,
  type InnerTxnEvidence,
} from '../../../lib/swap/guaranteeStore';
import { getIndexerClient } from '../../../lib/wallet/clients';
import { withAlgorandRetry } from '../../../lib/algorand/withRetry';

interface IndexerTxn {
  'tx-type'?: string;
  sender?: string;
  'confirmed-round'?: number;
  group?: string;
  id?: string;
  'inner-txns'?: IndexerTxn[];
  'asset-transfer-transaction'?: {
    receiver?: string;
    amount?: number;
    'asset-id'?: number;
  };
  'application-transaction'?: {
    'application-id'?: number;
  };
}

/**
 * Recursively collect all inner axfer transfers matching the target receiver + asset.
 * Only inner axfers from the confirmed swap group are authoritative.
 */
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
    if (inner['tx-type'] === 'axfer') {
      const at = inner['asset-transfer-transaction'];
      if (
        at &&
        at.receiver === targetReceiver &&
        Number(at['asset-id']) === targetAssetId &&
        typeof at.amount === 'number'
      ) {
        // Dedupe: use parentTxId + receiver + amount + assetId as key
        const dedupeKey = `${parentTxId}:${at.receiver}:${at.amount}:${at['asset-id']}`;
        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          results.push({
            txId: parentTxId,
            type: 'axfer',
            assetId: Number(at['asset-id']),
            amount: at.amount,
            receiver: at.receiver,
            confirmedRound,
          });
        }
      }
    }
    // Recurse into nested inner txns
    if (inner['inner-txns'] && inner['inner-txns'].length > 0) {
      results.push(
        ...collectInnerAxfers(inner['inner-txns'], targetReceiver, targetAssetId, parentTxId, confirmedRound, seen)
      );
    }
  }
  return results;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!isInstrumentationEnabled()) {
    return res.status(200).json({ success: true, verified: false, reason: 'instrumentation_disabled' });
  }

  const { quoteId } = req.body;
  if (!quoteId || typeof quoteId !== 'string') {
    return res.status(400).json({ success: false, error: 'quoteId required' });
  }

  try {
    // Load commitment (trusted source of truth)
    const commitment = await getCommitmentByQuoteId(quoteId);
    if (!commitment) {
      return res.status(404).json({ success: false, error: 'commitment_not_found' });
    }

    // Load outcome
    const outcome = await getOutcomeByQuoteId(quoteId);
    if (!outcome) {
      return res.status(404).json({ success: false, error: 'outcome_not_found' });
    }

    // Idempotency: already verified => no-op
    if (outcome.verificationStatus === 'verified') {
      return res.status(200).json({ success: true, verified: true, reason: 'already_verified' });
    }

    const attempts = (outcome.verificationAttempts || 0) + 1;
    const { userAddress, outputAsset, committedAmount } = commitment;

    // Dedupe swapTxnIds to prevent inflation
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

    // Load all referenced transactions from indexer
    const indexer = getIndexerClient();
    const loadedTxns: Array<{ txId: string; txn: IndexerTxn }> = [];
    const groups = new Set<string>();
    let hasApplWithInnerTxns = false;

    for (const txId of uniqueTxIds) {
      try {
        const result = await withAlgorandRetry(indexer.lookupTransactionByID(txId));
        const txn = (result as any).transaction as IndexerTxn;
        if (!txn || !txn['confirmed-round']) {
          continue; // Skip unconfirmed
        }
        if (txn.group) {
          groups.add(txn.group);
        }
        if (txn['tx-type'] === 'appl' && txn['inner-txns'] && txn['inner-txns'].length > 0) {
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

    // Require all txids share the same confirmed group
    if (groups.size > 1) {
      await updateOutcomeVerification(quoteId, {
        verificationStatus: 'failed',
        verificationError: `multiple_groups_detected: ${Array.from(groups).join(', ')}`,
        verificationAttempts: attempts,
        verificationTimestamp: Date.now(),
      });
      return res.status(200).json({ success: true, verified: false, reason: 'multiple_groups' });
    }

    // Swap-context validation: group must contain at least one appl tx with inner txns
    // Only inner axfers from the confirmed swap group are authoritative evidence.
    if (!hasApplWithInnerTxns) {
      await updateOutcomeVerification(quoteId, {
        verificationStatus: 'failed',
        verificationError: 'no_appl_with_inner_txns_in_group',
        verificationAttempts: attempts,
        verificationTimestamp: Date.now(),
      });
      return res.status(200).json({ success: true, verified: false, reason: 'no_swap_context' });
    }

    // Collect authoritative inner axfers from the verified swap group
    const seen = new Set<string>();
    const allEvidence: InnerTxnEvidence[] = [];
    for (const { txId, txn } of loadedTxns) {
      if (txn['tx-type'] === 'appl' && txn['inner-txns']) {
        const found = collectInnerAxfers(
          txn['inner-txns'],
          userAddress,
          outputAsset,
          txId,
          txn['confirmed-round']!,
          seen
        );
        allEvidence.push(...found);
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

    // Sum all deduped matching inner axfer amounts
    const authoritativeReceived = allEvidence.reduce((sum, e) => sum + e.amount, 0);
    const authoritativeShortfall = Math.max(0, committedAmount - authoritativeReceived);
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

    return res.status(200).json({
      success: true,
      verified: true,
      verificationStatus,
      authoritativeReceived,
      authoritativeShortfall,
      discrepancyFlag,
      discrepancyAmount,
      evidenceCount: allEvidence.length,
    });
  } catch (err: any) {
    console.error('[swap/verify-outcome]', err);
    // Increment attempts on error
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
