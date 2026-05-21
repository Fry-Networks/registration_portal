import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import algosdk from 'algosdk';
import { recordGuaranteeEvent, computeOrderHash, type QuoteCommitment } from '../../../lib/swap/guaranteeStore';
import {
  isGuaranteeEnabled,
  isGuaranteePaused,
  getApprovedSources,
  getAllowedTargetAssets,
  getQuoteTtlSec,
  getSwapDeadlineSec,
  getSettlementDeadlineSec,
} from '../../../lib/swap/guaranteeConfig';
import { isInstrumentationEnabled } from '../../../lib/swap/guaranteeInstrumentation';

import { getRankedQuotes, prepareAggregatorSwap } from '../../../lib/swap/aggregator';
import type { AggregatorQuote } from '../../../lib/swap/aggregator';

const SwapErrorType = {
  QUOTE_FAILED: 'QUOTE_FAILED',
  TX_PREP_FAILED: 'TX_PREP_FAILED',
  SIGNING_FAILED: 'SIGNING_FAILED',
  SUBMISSION_FAILED: 'SUBMISSION_FAILED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;

const REQUEST_TIMEOUT = 15000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { quote: clientQuote, sender, slippage } = req.body;

  if (!sender || typeof sender !== 'string') {
    return res.status(400).json({
      success: false,
      errorType: SwapErrorType.VALIDATION_FAILED,
      message: 'sender address required',
    });
  }

  if (!algosdk.isValidAddress(sender)) {
    return res.status(400).json({
      success: false,
      errorType: SwapErrorType.VALIDATION_FAILED,
      message: 'Invalid Algorand address',
    });
  }

  if (!clientQuote || typeof clientQuote !== 'object') {
    return res.status(400).json({
      success: false,
      errorType: SwapErrorType.VALIDATION_FAILED,
      message: 'quote object required',
    });
  }

  if (clientQuote.aggregator === 'vestige') {
    const hasRoute = clientQuote.rawQuote?.combo || clientQuote.rawQuote?.single;
    if (!hasRoute) {
      return res.status(400).json({
        success: false,
        errorType: SwapErrorType.VALIDATION_FAILED,
        message: 'quote missing route (combo or single)',
      });
    }
  }

  try {
    let rankedQuotes: AggregatorQuote[];
    try {
      rankedQuotes = await getRankedQuotes(
        Number(clientQuote.asset_in) || 0,
        Number(clientQuote.asset_out) || 0,
        Number(clientQuote.amount) || 0
      );
    } catch (quoteErr: any) {
      return res.status(502).json({
        success: false,
        errorType: SwapErrorType.QUOTE_FAILED,
        message: quoteErr.message || 'No aggregator returned a valid quote',
      });
    }

    if (rankedQuotes.length === 0) {
      return res.status(502).json({
        success: false,
        errorType: SwapErrorType.QUOTE_FAILED,
        message: 'No aggregator returned a valid quote',
      });
    }

    const bestQuote = rankedQuotes[0];

    let transactions: string[];
    let usedAggregator: string;
    try {
      const prep = await prepareAggregatorSwap(rankedQuotes, sender, slippage);
      transactions = prep.transactions;
      usedAggregator = prep.usedAggregator;
    } catch (prepErr: any) {
      const isTxPrep = prepErr.message?.includes('TX_PREP_FAILED');
      return res.status(502).json({
        success: false,
        errorType: isTxPrep ? SwapErrorType.TX_PREP_FAILED : SwapErrorType.QUOTE_FAILED,
        message: prepErr.message || 'Swap preparation failed',
        ...(isTxPrep && { aggregatorErrors: prepErr.aggregatorErrors }),
      });
    }

    if (transactions.length === 0) {
      return res.status(502).json({
        success: false,
        errorType: SwapErrorType.TX_PREP_FAILED,
        message: 'No valid transactions returned from aggregator',
      });
    }

    const shouldRecord = isInstrumentationEnabled() || (isGuaranteeEnabled() && !isGuaranteePaused());
    let quoteId: string | undefined;
    let guaranteeInfo: Record<string, unknown> | undefined;

    if (shouldRecord) {
      quoteId = crypto.randomUUID();
      const now = Date.now();
      const rawAmountOut = Number(bestQuote.amount_out) || 0;

      const fromId = Number(bestQuote.asset_in) || 0;
      const toId = Number(bestQuote.asset_out) || 0;
      const guaranteeEligible = isGuaranteeEnabled() && !isGuaranteePaused()
        && getApprovedSources().includes(fromId)
        && getAllowedTargetAssets().includes(toId);

      const slippagePct = typeof slippage === 'number' && slippage > 0 && slippage < 1
        ? slippage * 100
        : typeof slippage === 'number' && slippage >= 1
          ? slippage : 1;

      const settlementDeadline = now + getSettlementDeadlineSec() * 1000;

      const commitment: QuoteCommitment = {
        type: 'quote_commitment',
        quoteId,
        status: 'pending',
        lockTimestamp: now,
        expiryTimestamp: now + getQuoteTtlSec() * 1000,
        swapSubmissionDeadline: now + getSwapDeadlineSec() * 1000,
        settlementDeadline,
        inputAsset: fromId,
        inputAmount: Number(bestQuote.amount) || 0,
        outputAsset: toId,
        rawAmountOut,
        guaranteedAmount: rawAmountOut,
        estimatedAmount: rawAmountOut,
        slippagePct,
        vestigeMode: String(bestQuote.mode || 'sef'),
        userAddress: sender,
        priceImpact: Number(bestQuote.price_impact) || 0,
        networkFee: Number(bestQuote.network_fee) || 0,
        assetInPrice: Number(bestQuote.asset_in_price) || 0,
        assetOutPrice: Number(bestQuote.asset_out_price) || 0,
        guaranteeEligible,
        routeLiquidityUsd: 0,
        liquiditySource: 'deferred_to_quote',
        orderHash: guaranteeEligible ? computeOrderHash({
          quoteId,
          walletAddress: sender,
          targetAssetId: toId,
          guaranteedAmount: rawAmountOut,
          settlementDeadline,
        }) : undefined,
        createdAt: new Date(),
      };

      try {
        await recordGuaranteeEvent(commitment);
      } catch (err) {
        console.error('[swap/execute] Failed to record commitment:', err);
      }

      if (guaranteeEligible) {
        guaranteeInfo = {
          guaranteedAmount: rawAmountOut,
          guaranteedAssetId: toId,
          settlementDeadline,
        };
      }
    }

    return res.status(200).json({
      success: true,
      transactions,
      usedAggregator,
      ...(quoteId !== undefined && { quoteId }),
      ...(guaranteeInfo !== undefined && { guarantee: guaranteeInfo }),
    });
  } catch (err: any) {
    const status = err.response?.status || 500;
    const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Swap failed';
    console.error('[swap/execute]', { status, message, body: req.body });
    return res.status(status).json({
      success: false,
      errorType: SwapErrorType.SUBMISSION_FAILED,
      message,
    });
  }
}
