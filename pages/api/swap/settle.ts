/**
 * POST /api/swap/settle
 *
 * Settles a verified shortfall by calling the on-chain vault contract.
 * Zero client trust: uses server-verified authoritative data only.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getCommitmentByQuoteId,
  getOutcomeByQuoteId,
  updateOutcomeSettlement,
  getDailyWalletTopup,
  getDailyGlobalTopup,
  getUtcDayBounds,
} from '../../../lib/swap/guaranteeStore';
import { executeSettlement } from '../../../lib/swap/guaranteeSettlement';
import {
  isGuaranteeEnabled,
  isGuaranteePaused,
  getMaxTopupPerSwap,
  getMaxTopupPerWalletDay,
  getMaxTopupGlobalDay,
} from '../../../lib/swap/guaranteeConfig';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!isGuaranteeEnabled()) {
    return res.status(200).json({ success: true, settled: false, reason: 'guarantee_disabled' });
  }
  if (isGuaranteePaused()) {
    return res.status(200).json({ success: true, settled: false, reason: 'guarantee_paused' });
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
    if (!commitment.guaranteeEligible) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'ineligible' });
      return res.status(200).json({ success: true, settled: false, reason: 'not_eligible' });
    }

    const outcome = await getOutcomeByQuoteId(quoteId);
    if (!outcome) {
      return res.status(404).json({ success: false, error: 'outcome_not_found' });
    }
    if (outcome.verificationStatus !== 'verified' && outcome.verificationStatus !== 'discrepancy') {
      return res.status(200).json({ success: true, settled: false, reason: 'not_verified' });
    }
    if (outcome.settlementStatus === 'settled') {
      return res.status(200).json({ success: true, settled: false, reason: 'already_settled' });
    }

    // Shortfall from server-verified data ONLY
    const authReceived = outcome.authoritativeReceived || 0;
    const guaranteed = commitment.guaranteedAmount || 0;
    const shortfall = Math.max(0, guaranteed - authReceived);

    if (shortfall === 0) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'skipped', settlementAmount: 0 });
      return res.status(200).json({ success: true, settled: false, reason: 'no_shortfall' });
    }

    // Settlement deadline
    if (Date.now() > commitment.settlementDeadline) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'failed', settlementError: 'settlement_expired' });
      return res.status(200).json({ success: true, settled: false, reason: 'settlement_expired' });
    }

    // Cap checks
    if (BigInt(shortfall) > getMaxTopupPerSwap()) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'failed', settlementError: 'exceeds_per_swap_cap' });
      return res.status(200).json({ success: true, settled: false, reason: 'exceeds_per_swap_cap' });
    }

    const { start, end } = getUtcDayBounds();
    const [walletDaily, globalDaily] = await Promise.all([
      getDailyWalletTopup(commitment.userAddress, start, end),
      getDailyGlobalTopup(start, end),
    ]);

    if (BigInt(walletDaily) + BigInt(shortfall) > getMaxTopupPerWalletDay()) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'failed', settlementError: 'wallet_daily_cap' });
      return res.status(200).json({ success: true, settled: false, reason: 'wallet_daily_cap' });
    }
    if (BigInt(globalDaily) + BigInt(shortfall) > getMaxTopupGlobalDay()) {
      await updateOutcomeSettlement(quoteId, { settlementStatus: 'failed', settlementError: 'global_daily_cap' });
      return res.status(200).json({ success: true, settled: false, reason: 'global_daily_cap' });
    }

    // Execute on-chain settlement
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

    return res.status(200).json({
      success: true,
      settled: true,
      settlementTxId: result.txId,
      shortfallAmount: shortfall,
      confirmedRound: result.confirmedRound,
    });
  } catch (err: any) {
    console.error('[swap/settle]', err);
    try {
      await updateOutcomeSettlement(quoteId, {
        settlementStatus: 'failed',
        settlementError: err.message || 'settlement_error',
      });
    } catch { /* best effort */ }
    return res.status(500).json({ success: false, error: 'Settlement failed' });
  }
}
