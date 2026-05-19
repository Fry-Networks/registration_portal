import type { NextApiRequest, NextApiResponse } from 'next';
import algosdk from 'algosdk';
import { getVestigeQuote } from '../../../lib/swap/fryfarmAdapter';
import { isSourceAssetAllowed, isTargetTokenSupported } from '../../../lib/swap/allowlist';
import { checkRouteLiquidity } from '../../../lib/swap/guaranteeLiquidity';
import {
  isGuaranteeEnabled,
  isGuaranteePaused,
  getApprovedSources,
  getAllowedTargetAssets,
  getMaxTopupPerSwap,
  getMaxTopupPerWalletDay,
  getMaxTopupGlobalDay,
  getVaultAppId,
  getQuoteTtlSec,
  getSwapDeadlineSec,
  getSettlementDeadlineSec,
} from '../../../lib/swap/guaranteeConfig';
import { getDailyWalletTopup, getDailyGlobalTopup, getUtcDayBounds } from '../../../lib/swap/guaranteeStore';
import { getAlgodClient } from '../../../lib/wallet/clients';
import { getDefaultNetwork } from '../../../lib/wallet/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const params = req.method === 'GET' ? req.query : req.body;
  const { fromASA, toASA, amount, wallet } = params;

  const fromId = Number(fromASA);
  const toId = Number(toASA);
  const amt = Number(amount);
  const walletAddr = typeof wallet === 'string' ? wallet : '';

  if (!Number.isFinite(fromId) || !Number.isFinite(toId) || !Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ success: false, error: 'Invalid parameters' });
  }

  if (!isSourceAssetAllowed(fromId)) {
    return res.status(400).json({ success: false, error: 'Source asset not allowed' });
  }

  if (!isTargetTokenSupported(toId)) {
    return res.status(400).json({ success: false, error: 'Target token not supported' });
  }

  try {
    const quote = await getVestigeQuote(fromId, toId, amt);

    // Guarantee eligibility assessment
    let guarantee: Record<string, unknown> | null = null;

    if (isGuaranteeEnabled() && !isGuaranteePaused()) {
      const now = Date.now();
      const reasons: string[] = [];
      let eligible = true;

      // Source asset check
      if (!getApprovedSources().includes(fromId)) {
        eligible = false;
        reasons.push('Source asset not in approved list');
      }

      // Target asset check
      if (!getAllowedTargetAssets().includes(toId)) {
        eligible = false;
        reasons.push('Target asset not in guarantee allowlist');
      }

      // Liquidity check
      if (eligible) {
        const liq = await checkRouteLiquidity(quote);
        if (!liq.eligible) {
          eligible = false;
          reasons.push(liq.reason || 'Insufficient route liquidity');
        }
        guarantee = { routeLiquidityUsd: liq.routeLiquidityUsd, liquiditySource: liq.liquiditySource };
      }

      // guaranteedAmount = full quoted output (locked at quote time)
      const guaranteedAmount = Number(quote.amount_out) || 0;

      // Per-swap cap check (worst-case: full guaranteedAmount is shortfall)
      if (eligible && BigInt(guaranteedAmount) > getMaxTopupPerSwap()) {
        eligible = false;
        reasons.push('Swap amount exceeds per-swap guarantee cap');
      }

      // Per-wallet/day and global/day cap checks (if wallet provided)
      if (eligible && walletAddr && algosdk.isValidAddress(walletAddr)) {
        const { start, end } = getUtcDayBounds();
        const [walletDaily, globalDaily] = await Promise.all([
          getDailyWalletTopup(walletAddr, start, end),
          getDailyGlobalTopup(start, end),
        ]);
        if (BigInt(walletDaily) + BigInt(guaranteedAmount) > getMaxTopupPerWalletDay()) {
          eligible = false;
          reasons.push('Wallet daily guarantee limit reached');
        }
        if (BigInt(globalDaily) + BigInt(guaranteedAmount) > getMaxTopupGlobalDay()) {
          eligible = false;
          reasons.push('Global daily guarantee limit reached');
        }
      }

      // Vault reserve sufficiency check
      if (eligible && getVaultAppId()) {
        try {
          const algod = getAlgodClient(getDefaultNetwork());
          const vaultAddr = algosdk.getApplicationAddress(getVaultAppId());
          const vaultInfo = await algod.accountInformation(vaultAddr).do();
          const vaultAssets = (vaultInfo.assets || []) as any[];
          const fryAsset = vaultAssets.find((a: any) => Number(a.assetId || a['asset-id']) === toId);
          const vaultBalance = Number(fryAsset?.amount || 0);
          if (vaultBalance < guaranteedAmount) {
            eligible = false;
            reasons.push('Insufficient vault reserve');
          }
        } catch {
          eligible = false;
          reasons.push('Unable to verify vault reserve');
        }
      } else if (eligible && !getVaultAppId()) {
        eligible = false;
        reasons.push('Vault not configured');
      }

      guarantee = {
        ...guarantee,
        eligible,
        guaranteedAmount: eligible ? guaranteedAmount : 0,
        estimatedAmount: guaranteedAmount,
        guaranteedAssetId: toId,
        quoteExpiresAt: now + getQuoteTtlSec() * 1000,
        swapSubmissionDeadline: now + getSwapDeadlineSec() * 1000,
        settlementDeadline: now + getSettlementDeadlineSec() * 1000,
        assetOutPrice: quote.asset_out_price,
        reason: eligible ? null : reasons.join('; '),
      };
    }

    return res.status(200).json({ success: true, quote, ...(guarantee ? { guarantee } : {}) });
  } catch (err: any) {
    console.error('[swap/quote]', err);
    return res.status(500).json({ success: false, error: err.message || 'Quote failed' });
  }
}
