import { ASA_IDS } from './constants';

export const ALLOWED_SOURCE_IDS = [ASA_IDS.ALGO, ASA_IDS.USDC, ASA_IDS.USDT] as const;
export const ALLOWED_TARGET_IDS = [ASA_IDS.FRY, ASA_IDS.FNODE, ASA_IDS.FVPN] as const;

export function isSourceAssetAllowed(assetId: number): boolean {
  return ALLOWED_SOURCE_IDS.includes(assetId as any);
}

export function isTargetTokenSupported(assetId: number): boolean {
  return ALLOWED_TARGET_IDS.includes(assetId as any);
}

export function getTokenBySymbol(symbol: string): { id: number; symbol: string; name: string; decimals: number } | undefined {
  const all = [
    { id: ASA_IDS.ALGO, symbol: 'ALGO', name: 'Algorand', decimals: 6 },
    { id: ASA_IDS.USDC, symbol: 'USDC', name: 'USDC', decimals: 6 },
    { id: ASA_IDS.USDT, symbol: 'USDT', name: 'USDT', decimals: 6 },
    { id: ASA_IDS.FRY, symbol: 'FRY', name: 'FRY 2.0', decimals: 6 },
    { id: ASA_IDS.FNODE, symbol: 'fNODE', name: 'fNODE', decimals: 6 },
    { id: ASA_IDS.FVPN, symbol: 'fVPN', name: 'fVPN', decimals: 6 },
  ];
  return all.find((t) => t.symbol.toLowerCase() === symbol.toLowerCase());
}
