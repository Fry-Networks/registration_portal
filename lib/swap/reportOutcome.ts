/**
 * Client-safe swap outcome reporting helper.
 *
 * No server imports, no MongoDB. Safe for use in React components.
 * Reports client-observed balance delta as UNTRUSTED TELEMETRY.
 */
import { getAlgodClient } from '../wallet/clients';
import { getDefaultNetwork } from '../wallet/config';

/**
 * Query current balance of an ASA for a given address via algod.
 */
export async function getAssetBalance(address: string, assetId: number): Promise<number> {
  const algod = getAlgodClient(getDefaultNetwork());
  const info = await algod.accountInformation(address).do();
  const assets = (info.assets || []) as Array<{ 'asset-id'?: number | bigint | string; amount?: number | bigint }>;
  const found = assets.find((a) => Number(a['asset-id']) === assetId);
  return Number(found?.amount ?? 0);
}

/**
 * Fire-and-forget: report swap outcome telemetry to the server.
 * Never throws — failures are silently caught to avoid breaking swap UX.
 */
export async function reportSwapOutcome(params: {
  quoteId: string;
  userAddress: string;
  outputAsset: number;
  swapTxnIds: string[];
  clientReportedPreBalance: number;
  clientReportedPostBalance: number;
  confirmedRound?: number;
}): Promise<void> {
  try {
    await fetch('/api/swap/report-outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
  } catch {
    // Never break swap UX — outcome reporting is telemetry only
  }
}
