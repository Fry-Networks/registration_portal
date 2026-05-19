/**
 * POST /api/swap/report-outcome
 *
 * Records client-reported swap outcome telemetry. This data is UNTRUSTED —
 * it reflects what the client observed, not independently verified settlement.
 *
 * No payout logic. No treasury signing. No user-facing guarantee claims.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import algosdk from 'algosdk';
import { isInstrumentationEnabled } from '../../../lib/swap/guaranteeInstrumentation';
import {
  recordGuaranteeEvent,
  getCommitmentByQuoteId,
  getOutcomeByQuoteId,
  markCommitmentConsumed,
  type SwapOutcome,
} from '../../../lib/swap/guaranteeStore';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  if (!isInstrumentationEnabled()) {
    return res.status(200).json({ success: true, recorded: false, reason: 'instrumentation_disabled' });
  }

  const {
    quoteId,
    userAddress,
    outputAsset,
    swapTxnIds,
    clientReportedPreBalance,
    clientReportedPostBalance,
    confirmedRound,
  } = req.body;

  // Input validation
  if (!quoteId || typeof quoteId !== 'string') {
    return res.status(400).json({ success: false, error: 'quoteId required' });
  }
  if (!userAddress || typeof userAddress !== 'string' || !algosdk.isValidAddress(userAddress)) {
    return res.status(400).json({ success: false, error: 'Valid userAddress required' });
  }
  if (!Array.isArray(swapTxnIds) || swapTxnIds.length === 0) {
    return res.status(400).json({ success: false, error: 'swapTxnIds required' });
  }

  try {
    // Server-side correlation: load and verify prior commitment
    const commitment = await getCommitmentByQuoteId(quoteId);
    if (!commitment) {
      return res.status(404).json({ success: false, error: 'commitment_not_found' });
    }
    if (commitment.userAddress !== userAddress) {
      return res.status(403).json({ success: false, error: 'address_mismatch' });
    }
    if (commitment.outputAsset !== Number(outputAsset)) {
      return res.status(400).json({ success: false, error: 'asset_mismatch' });
    }

    // Idempotency check (G3 prep)
    const existing = await getOutcomeByQuoteId(quoteId);
    if (existing) {
      return res.status(200).json({ success: true, recorded: false, reason: 'already_reported' });
    }

    // Compute client-reported received + tentative shortfall (non-authoritative telemetry)
    const preBalance = Number(clientReportedPreBalance) || 0;
    const postBalance = Number(clientReportedPostBalance) || 0;
    const clientReportedReceived = Math.max(0, postBalance - preBalance);
    const tentativeShortfall = Math.max(0, commitment.guaranteedAmount - clientReportedReceived);

    const outcome: SwapOutcome = {
      type: 'swap_outcome',
      quoteId,
      outcomeSource: 'client_report',
      userAddress,
      outputAsset: Number(outputAsset) || 0,
      clientReportedPreBalance: preBalance,
      clientReportedPostBalance: postBalance,
      clientReportedReceived,
      tentativeShortfall,
      swapTxnIds,
      confirmedRound: Number(confirmedRound) || 0,
      timestamp: Date.now(),
      verificationStatus: "pending" as const,
      createdAt: new Date(),
    };

    await recordGuaranteeEvent(outcome);

    // Mark commitment as consumed (G4 prep)
    await markCommitmentConsumed(quoteId);

    return res.status(200).json({ success: true, recorded: true });
  } catch (err: any) {
    console.error('[swap/report-outcome]', err);
    return res.status(500).json({ success: false, error: 'Failed to record outcome' });
  }
}
