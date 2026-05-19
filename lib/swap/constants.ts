export const ASA_IDS = {
  ALGO: 0,
  USDC: 31566704,
  USDT: 312769,
  FRY: 2485314946,
  FNODE: 2485202024,
  FVPN: 2485198745,
} as const;

export const TARGET_TOKENS = [
  { id: ASA_IDS.FRY, symbol: 'FRY', name: 'FRY 2.0' },
  { id: ASA_IDS.FNODE, symbol: 'fNODE', name: 'fNODE' },
  { id: ASA_IDS.FVPN, symbol: 'fVPN', name: 'fVPN' },
] as const;

export const SOURCE_TOKENS = [
  { id: ASA_IDS.ALGO, symbol: 'ALGO', name: 'Algorand', decimals: 6 },
  { id: ASA_IDS.USDC, symbol: 'USDC', name: 'USDC', decimals: 6 },
  { id: ASA_IDS.USDT, symbol: 'USDT', name: 'USDT', decimals: 6 },
] as const;

export const VESTIGE_QUOTE_URL = 'http://192.168.12.84/api/swap/vestige/quote';
export const FOLKS_QUOTE_URL = 'http://192.168.12.84/api/swap/folks/quote';
export const DENOMINATING_ASSET_ID = ASA_IDS.USDC;
export const QUOTE_TTL_MS = 30_000;
export const MAX_PRICE_IMPACT = 0.05; // 5%
export const DEFAULT_SLIPPAGE_BPS = 100; // 1%
