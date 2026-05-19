import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import axios from 'axios';
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

const VESTIGE_PROXY_URL = 'http://192.168.12.84/api/swap/vestige/transactions';
const REQUEST_TIMEOUT = 15000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { quote, sender, slippage } = req.body;

  if (!sender || typeof sender !== 'string') {
    return res.status(400).json({ success: false, error: 'sender address required' });
  }

  if (!algosdk.isValidAddress(sender)) {
    return res.status(400).json({ success: false, error: 'Invalid Algorand address' });
  }

  if (!quote || typeof quote !== 'object') {
    return res.status(400).json({ success: false, error: 'quote object required' });
  }

  const hasRoute = quote.combo || quote.single;
  if (!hasRoute) {
    return res.status(400).json({ success: false, error: 'quote missing route (combo or single)' });
  }

  try {
    const { data } = await axios.post(VESTIGE_PROXY_URL, quote, {
      params: { sender, slippage },
      timeout: REQUEST_TIMEOUT,
      headers: { 'Content-Type': 'application/json' },
    });

    if (!Array.isArray(data) || data.length === 0) {
      return res.status(502).json({ success: false, error: 'Vestige returned empty transaction group' });
    }

    const transactions = data.map((entry: any) =>
      typeof entry === 'string' ? entry : entry?.txn
    ).filter((t: any): t is string => typeof t === 'string');

    if (transactions.length === 0) {
      return res.status(502).json({ success: false, error: 'No valid transactions returned from Vestige' });
    }

    const shouldRecord = isInstrumentationEnabled() || (isGuaranteeEnabled() && !isGuaranteePaused());
    let quoteId: string | undefined;
    let guaranteeInfo: Record<string, unknown> | undefined;

    if (shouldRecord) {
      quoteId = crypto.randomUUID();
      const now = Date.now();
      const rawAmountOut = Number(quote.amount_out) || 0;

      const fromId = Number(quote.asset_in) || 0;
      const toId = Number(quote.asset_out) || 0;
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
        inputAmount: Number(quote.amount) || 0,
        outputAsset: toId,
        rawAmountOut,
        guaranteedAmount: rawAmountOut,
        estimatedAmount: rawAmountOut,
        slippagePct,
        vestigeMode: String(quote.mode || 'sef'),
        userAddress: sender,
        priceImpact: Number(quote.price_impact) || 0,
        networkFee: Number(quote.network_fee) || 0,
        assetInPrice: Number(quote.asset_in_price) || 0,
        assetOutPrice: Number(quote.asset_out_price) || 0,
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
      ...(quoteId !== undefined && { quoteId }),
      ...(guaranteeInfo !== undefined && { guarantee: guaranteeInfo }),
    });
  } catch (err: any) {
    const status = err.response?.status || 502;
    const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Swap preparation failed';
    console.error('[swap/execute]', { status, message, body: req.body });
    return res.status(status).json({ success: false, error: message });
  }
}
