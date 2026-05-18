import { VESTIGE_QUOTE_URL, DENOMINATING_ASSET_ID } from './constants';

export interface VestigeSwapTransaction {
  provider: string;
  application_id: number;
  amount_in: number;
  amount_out: number;
  fee: number;
  network_fee: number;
}

export interface VestigeRouteTransaction {
  asset_in: number;
  asset_out: number;
  amount_in: number;
  amount_out: number;
  network_fee: number;
  swaps: VestigeSwapTransaction[];
}

export interface VestigeQuote {
  mode: string;
  amount: number;
  asset_in: number;
  asset_in_price: number;
  asset_out: number;
  asset_out_price: number;
  asset_images?: Record<string, string>;
  amount_out: number;
  network_fee: number;
  price_impact: number;
  combo: {
    asset_in: number;
    asset_out: number;
    amount_in: number;
    amount_out: number;
    network_fee: number;
    transactions: VestigeRouteTransaction[];
  };
  single: {
    asset_in: number;
    asset_out: number;
    amount_in: number;
    amount_out: number;
    network_fee: number;
    transactions: VestigeRouteTransaction[];
  };
}

export async function getVestigeQuote(
  fromASA: number,
  toASA: number,
  amount: number
): Promise<VestigeQuote> {
  const url = new URL(VESTIGE_QUOTE_URL);
  url.searchParams.set('from_asa', String(fromASA));
  url.searchParams.set('to_asa', String(toASA));
  url.searchParams.set('amount', String(amount));
  url.searchParams.set('mode', 'sef');
  url.searchParams.set('denominating_asset_id', String(DENOMINATING_ASSET_ID));

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Vestige quote failed: ${res.status} ${res.statusText} — ${text}`);
  }
  const data = await res.json();
  if (!data || typeof data.amount_out !== 'number') {
    throw new Error('Invalid Vestige quote response');
  }
  return data as VestigeQuote;
}
