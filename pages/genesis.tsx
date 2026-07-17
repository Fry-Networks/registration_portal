'use client';

import PageShell from '../components/PageShell';
import { useWallet } from '@txnlab/use-wallet-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import algosdk from 'algosdk';
import { useToastContext } from '../hooks/ToastContext';

const APP_ID = 3636406117;
const USDC_ASA_ID = 31566704;
const TREASURY_E2F2LT = 'E2F2LT2INE75DBOYHQXTCTOP2PAP5MHAXQRXTTCCXFKHQTVG36DJONBQZE';

interface ConfigData {
  app_id: number;
  app_address: string;
  total_supply: number;
  total_minted: number;
  paused: boolean;
  mint_price_micro: number;
  mint_asset_id: number;
  fee_share_bps: number;
  accumulated: Record<string, number>;
  active_token: {
    mode: string;
    asa_id: string;
    name: string;
  };
}

interface HoldingsData {
  wallet: string;
  count: number;
  token_ids: number[];
}

interface Distribution {
  distributed_at: string;
  amount: number;
  token: string;
  txn_id?: string;
}

interface EstimateData {
  wallet: string;
  holdings_count: number;
  per_pass_estimate: number;
  total_estimate: number;
}

export default function GenesisPage() {
  const { activeAccount, algodClient, transactionSigner, wallets } = useWallet();
  const { resolvedTheme } = useTheme();
  const { success: toastSuccess, info, error: toastError } = useToastContext();
  const isDark = resolvedTheme !== 'light';

  const [config, setConfig] = useState<ConfigData | null>(null);
  const [holdings, setHoldings] = useState<HoldingsData | null>(null);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [estimate, setEstimate] = useState<EstimateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [minting, setMinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch config on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch('/api/genesis/fry-fee/config');
        if (res.ok) {
          const data = await res.json();
          setConfig(data);
        }
      } catch (err: any) {
        console.error('Config fetch error:', err);
      }
    };
    fetchConfig();
  }, []);

  // Fetch holdings and estimate when wallet connects
  useEffect(() => {
    if (!activeAccount?.address) {
      setHoldings(null);
      setEstimate(null);
      return;
    }

    const fetchHoldingsAndEstimate = async () => {
      setLoading(true);
      try {
        const [holdingsRes, estimateRes] = await Promise.all([
          fetch(`/api/genesis/fry-fee/holdings/${activeAccount.address}`),
          fetch(`/api/genesis/fry-fee/estimate/${activeAccount.address}`),
        ]);

        if (holdingsRes.ok) {
          const data = await holdingsRes.json();
          setHoldings(data);
        }
        if (estimateRes.ok) {
          const data = await estimateRes.json();
          setEstimate(data);
        }
      } catch (err: any) {
        console.error('Holdings/estimate fetch error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchHoldingsAndEstimate();
  }, [activeAccount?.address]);

  // Fetch distributions on mount
  useEffect(() => {
    const fetchDistributions = async () => {
      try {
        const res = await fetch('/api/genesis/fry-fee/distributions');
        if (res.ok) {
          const data = await res.json();
          setDistributions(data.distributions || []);
        }
      } catch (err: any) {
        console.error('Distributions fetch error:', err);
      }
    };
    fetchDistributions();
  }, []);

  const handleMint = useCallback(async () => {
    if (!activeAccount?.address || !algodClient || !transactionSigner || !config) {
      setError('Wallet not properly connected');
      return;
    }

    try {
      setMinting(true);
      setError(null);

      const addr = activeAccount.address;

      // Pre-checks
      let minterAccount;
      try {
        minterAccount = await algodClient.accountInformation(addr).do();
      } catch (err: any) {
        setError('Could not fetch account information');
        return;
      }

      // Check USDC opt-in and balance
      const usdcBalance = minterAccount.assets?.find(
        (a: any) => a['asset-id'] === USDC_ASA_ID
      );
      if (!usdcBalance) {
        setError('USDC not opted in. Please opt in to USDC (ASA 31566704) first.');
        return;
      }

      const usdcAmount = usdcBalance.amount || 0;
      if (usdcAmount < config.mint_price_micro) {
        setError(
          `Insufficient USDC. Need ${(config.mint_price_micro / 1e6).toFixed(2)}, have ${(
            usdcAmount / 1e6
          ).toFixed(2)}`
        );
        return;
      }

      // Check ALGO balance
      const requiredMbr = holdings && holdings.count > 0 ? 18900 : 37800;
      const requiredAlgo = requiredMbr + 4000 + 1000; // MBR + fee buffer
      const algoBalance = minterAccount.amount || 0;
      if (algoBalance < requiredAlgo) {
        setError(
          `Insufficient ALGO for fees and box storage. Need ${(requiredAlgo / 1e6).toFixed(6)}, have ${(
            algoBalance / 1e6
          ).toFixed(6)}`
        );
        return;
      }

      // Build group
      const sp = await algodClient.getTransactionParams().do();
      const appAddr = algosdk.getApplicationAddress(APP_ID);

      // Method call — mint(axfer,pay)uint64. Use the connected wallet's
      // transactionSigner directly; ATC handles group/sign/submit/wait.
      const method = algosdk.ABIMethod.fromSignature('mint(axfer,pay)uint64');
      const atc = new algosdk.AtomicTransactionComposer();

      // USDC transfer (mint price -> app)
      const usdcPay = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: addr,
        receiver: appAddr,
        amount: config.mint_price_micro,
        assetIndex: USDC_ASA_ID,
        suggestedParams: { ...sp, flatFee: true, fee: 1000 },
      });

      // Box-MBR payment (minter funds their own box rent -> app)
      const mbrPay = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: addr,
        receiver: appAddr,
        amount: requiredMbr,
        suggestedParams: { ...sp, flatFee: true, fee: 1000 },
      });

      // Box names: 'o' + uint64_be(next token id); 'b' + minter pubkey
      const oBoxName = new Uint8Array(9);
      oBoxName[0] = 0x6f; // 'o'
      const nextTokenId = (config.total_minted || 0) + 1;
      new DataView(oBoxName.buffer, 1, 8).setBigUint64(0, BigInt(nextTokenId), false);
      const bBoxName = new Uint8Array([0x62, ...algosdk.decodeAddress(addr).publicKey]);

      atc.addMethodCall({
        appID: APP_ID,
        method,
        sender: addr,
        signer: transactionSigner,
        methodArgs: [
          { txn: usdcPay, signer: transactionSigner },
          { txn: mbrPay, signer: transactionSigner },
        ],
        suggestedParams: { ...sp, flatFee: true, fee: 3000 },
        appForeignAssets: [USDC_ASA_ID],
        appAccounts: [TREASURY_E2F2LT],
        boxes: [
          { appIndex: APP_ID, name: oBoxName },
          { appIndex: APP_ID, name: bBoxName },
        ],
      });

      info({ heading: 'Submission', message: 'Mint submitted! Waiting for confirmation...' });

      const result = await atc.execute(algodClient, 8);
      const txId = result.txIDs[0];

      toastSuccess({
        heading: 'Success',
        message: `Pass minted! Tx ${txId.slice(0, 8)}…`,
      });
      // Refresh holdings and config
      try {
        const [cfgRes, hldRes] = await Promise.all([
          fetch('/api/genesis/fry-fee/config'),
          fetch(`/api/genesis/fry-fee/holdings/${addr}`),
        ]);
        if (cfgRes.ok) setConfig(await cfgRes.json());
        if (hldRes.ok) setHoldings(await hldRes.json());
      } catch {}
    } catch (err: any) {
      const msg = err?.message || 'Mint failed';
      setError(msg);
      toastError({ heading: 'Mint Failed', message: `Error: ${msg}` });
    } finally {
      setMinting(false);
    }
  }, [activeAccount, algodClient, transactionSigner, config, holdings, toastSuccess, info, toastError]);

  const available = config ? config.total_supply - config.total_minted : 0;
  const formattedMintPrice = config ? (config.mint_price_micro / 1000000).toFixed(2) : '0.00';
  const requiredMbr = holdings && holdings.count > 0 ? 18900 : 37800;
  const requiredMbrAlgo = (requiredMbr / 1e6).toFixed(6);

  return (
    <PageShell title="Genesis" breadcrumb={false}>
      <div className="space-y-6 py-6">
        {/* Collection Overview */}
        <div className="bg-surface-elevated border border-divider rounded-token-lg p-space-5">
          <h2 className="font-display text-2xl font-semibold text-ink mb-2">Fry Fee Genesis Pass</h2>
          <p className="text-ink-secondary mb-6">
            Hold a Fry Fee Genesis Pass to earn a share of the 30% instant-claim fee: one-third of the fee
            (10% of each claim) is split equally across all 2,000 passes, paid monthly. 2,000 total supply.
          </p>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-surface border border-divider rounded-token-md p-4">
              <div className="text-2xl font-display text-ink">
                {config ? config.total_supply : '...'}
              </div>
              <div className="text-sm text-ink-secondary mt-1">Total Supply</div>
            </div>
            <div className="bg-surface border border-divider rounded-token-md p-4">
              <div className="text-2xl font-display text-ink">
                {config ? config.total_minted : '...'}
              </div>
              <div className="text-sm text-ink-secondary mt-1">Minted</div>
            </div>
            <div className="bg-surface border border-divider rounded-token-md p-4">
              <div className="text-2xl font-display text-ink">
                {config ? available : '...'}
              </div>
              <div className="text-sm text-ink-secondary mt-1">Available</div>
            </div>
            <div className="bg-surface border border-divider rounded-token-md p-4">
              <div className="text-2xl font-display text-ink">
                {!activeAccount ? '—' : loading ? '...' : holdings?.count ?? 0}
              </div>
              <div className="text-sm text-ink-secondary mt-1">Your Holdings</div>
            </div>
          </div>

          {/* App ID Link */}
          {config && (
            <div className="mt-4 pt-4 border-t border-divider">
              <Link
                href={`https://allo.info/application/${config.app_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary-500 hover:underline"
              >
                View on Allo.info →
              </Link>
            </div>
          )}
        </div>

        {/* Mint Section */}
        {config && (
          <div className="bg-surface-elevated border border-divider rounded-token-lg p-space-5">
            <h3 className="font-display text-xl font-semibold text-ink mb-4">Mint a Pass</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div className="bg-surface border border-divider rounded-token-md p-4">
                <div className="text-sm text-ink-secondary">Mint Price</div>
                <div className="text-2xl font-display text-ink mt-1">{formattedMintPrice} USDC</div>
              </div>
              <div className="bg-surface border border-divider rounded-token-md p-4">
                <div className="text-sm text-ink-secondary">Remaining</div>
                <div className="text-2xl font-display text-ink mt-1">{available}</div>
              </div>
            </div>

            {!activeAccount ? (
              <div className="text-center py-4 text-ink-secondary">Connect your wallet to mint</div>
            ) : config.paused ? (
              <div className="flex items-center gap-3 py-3 px-4 bg-warning-500/10 border border-warning-500/30 rounded-token-md">
                <span className="text-sm text-warning-600 dark:text-warning-400">Minting Paused</span>
              </div>
            ) : (
              <>
                {error && (
                  <div className="mb-4 p-3 bg-error-500/10 border border-error-500/30 rounded-token-md text-sm text-error-600 dark:text-error-400">
                    {error}
                  </div>
                )}
                <div className="mb-4 text-xs text-ink-secondary">
                  Box storage: {requiredMbrAlgo} ALGO (paid to the contract, covers the pass&apos;s on-chain storage)
                </div>
                <button
                  onClick={handleMint}
                  disabled={minting || config.paused}
                  className="w-full py-3 px-4 bg-primary-500 text-ink font-semibold rounded-token-md hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed transition"
                >
                  {minting
                    ? 'Minting...'
                    : `Mint Pass — ${formattedMintPrice} USDC + ${(4000 / 1e6).toFixed(6)} ALGO`}
                </button>
              </>
            )}
          </div>
        )}

        {/* Your Passes */}
        {activeAccount && (
          <div className="bg-surface-elevated border border-divider rounded-token-lg p-space-5">
            <h3 className="font-display text-xl font-semibold text-ink mb-4">Your Passes</h3>

            {loading ? (
              <div className="text-center py-4 text-ink-secondary">Loading...</div>
            ) : holdings && holdings.count > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {holdings.token_ids.map((tokenId) => (
                  <div
                    key={tokenId}
                    className="bg-surface border border-divider rounded-token-md p-4 text-center hover:shadow-token-md transition"
                  >
                    <div className="text-sm font-semibold text-primary-500">Pass #{tokenId}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6 text-ink-secondary">No passes yet</div>
            )}
          </div>
        )}

        {/* Fee Distribution */}
        <div className="bg-surface-elevated border border-divider rounded-token-lg p-space-5">
          <h3 className="font-display text-xl font-semibold text-ink mb-4">Fee Distribution</h3>

          {estimate && activeAccount && holdings && holdings.count > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
              <div className="bg-surface border border-divider rounded-token-md p-4">
                <div className="text-sm text-ink-secondary">Per Pass Estimate</div>
                <div className="text-2xl font-display text-ink mt-1">{estimate.per_pass_estimate.toFixed(6)}</div>
              </div>
              <div className="bg-surface border border-divider rounded-token-md p-4">
                <div className="text-sm text-ink-secondary">Your Total Estimate</div>
                <div className="text-2xl font-display text-primary-500 mt-1">{estimate.total_estimate.toFixed(6)}</div>
              </div>
            </div>
          )}

          {/* Distributions Table */}
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-ink mb-3">Recent Distributions</h4>
            {distributions.length > 0 ? (
              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-divider">
                      <th className="text-left py-2 px-3 text-ink-secondary font-semibold">Date</th>
                      <th className="text-right py-2 px-3 text-ink-secondary font-semibold">Amount</th>
                      <th className="text-left py-2 px-3 text-ink-secondary font-semibold">Token</th>
                    </tr>
                  </thead>
                  <tbody>
                    {distributions.map((dist, idx) => (
                      <tr key={idx} className="border-b border-divider last:border-0 hover:bg-surface transition">
                        <td className="py-2 px-3 text-ink">
                          {new Date(dist.distributed_at).toLocaleDateString()}
                        </td>
                        <td className="text-right py-2 px-3 text-ink font-semibold">{dist.amount.toFixed(6)}</td>
                        <td className="py-2 px-3 text-ink-secondary">{dist.token}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-4 text-ink-secondary">No distributions yet</div>
            )}
          </div>

          <p className="text-sm text-ink-secondary">
            Distributions are paid in the active protocol token (currently <strong>{config?.active_token.name}</strong>).
          </p>
        </div>

        {/* Info Panel */}
        <div className="bg-surface-elevated border border-divider rounded-token-lg p-space-5">
          <h3 className="font-display text-lg font-semibold text-ink mb-4">About Fee Distributions</h3>
          <div className="space-y-3 text-sm text-ink-secondary">
            <p>
              Genesis Passes represent a permanent claim on one-third of the 30% instant-claim fee (10% of each claim)
              routed from the Fry Fee Vault; the remainder of the fee stays with the treasury. Each of the 2,000 passes
              earns an equal portion of that holder share. The prior month is paid on the 1st of each month, and a newly
              minted pass is paid its full backlog to date instantly on mint.
            </p>
            <p>
              <strong>Fee Distribution:</strong> One-third of the fee (10% of each claim), split equally across all 2,000
              passes; the prior month is paid on the 1st of each month, and full backlog is paid instantly on mint.
            </p>
            <p>
              <strong>Token Switching:</strong> Fee distributions are paid in the active protocol token. Switching between
              FRY 2.0 and FRY 3.0 does not affect your Genesis Pass or its fee-earning rights.
            </p>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
