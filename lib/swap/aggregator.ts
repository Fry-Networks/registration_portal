import axios from 'axios';
import { VESTIGE_QUOTE_URL, FOLKS_QUOTE_URL, DENOMINATING_ASSET_ID } from './constants';
import type { VestigeQuote } from './fryfarmAdapter';

export interface AggregatorQuote {
  aggregator: 'vestige' | 'folks';
  amount_out: number;
  price_impact: number;
  network_fee: number;
  asset_in: number;
  asset_out: number;
  amount: number;
  mode: string;
  asset_in_price?: number;
  asset_out_price?: number;
  rawQuote: any;
}

async function fetchVestigeQuote(fromASA: number, toASA: number, amount: number): Promise<VestigeQuote> {
  const { getVestigeQuote } = await import('./fryfarmAdapter');
  return getVestigeQuote(fromASA, toASA, amount);
}

async function fetchFolksQuote(fromASA: number, toASA: number, amount: number): Promise<any> {
  const url = new URL(FOLKS_QUOTE_URL);
  url.searchParams.set('from_asa', String(fromASA));
  url.searchParams.set('to_asa', String(toASA));
  url.searchParams.set('amount', String(amount));
  url.searchParams.set('mode', 'sef');
  url.searchParams.set('denominating_asset_id', String(DENOMINATING_ASSET_ID));

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Folks quote failed: ${res.status} ${res.statusText} — ${text}`);
  }
  const data = await res.json();
  if (!data.success || !data.result) {
    throw new Error(data.message || 'Invalid Folks quote response');
  }
  return data;
}

export async function getRankedQuotes(fromASA: number, toASA: number, amount: number): Promise<AggregatorQuote[]> {
  const results = await Promise.allSettled([
    fetchVestigeQuote(fromASA, toASA, amount),
    fetchFolksQuote(fromASA, toASA, amount),
  ]);

  const quotes: AggregatorQuote[] = [];

  if (results[0].status === 'fulfilled') {
    const v = results[0].value;
    quotes.push({
      aggregator: 'vestige',
      amount_out: v.amount_out,
      price_impact: v.price_impact,
      network_fee: v.network_fee,
      asset_in: v.asset_in,
      asset_out: v.asset_out,
      amount: v.amount,
      mode: v.mode || 'sef',
      asset_in_price: v.asset_in_price,
      asset_out_price: v.asset_out_price,
      rawQuote: v,
    });
  } else {
    console.error('[getRankedQuotes] Vestige failed:', results[0].reason);
  }

  if (results[1].status === 'fulfilled') {
    const f = results[1].value;
    quotes.push({
      aggregator: 'folks',
      amount_out: Number(f.result?.quoteAmount) || 0,
      price_impact: Number(f.result?.priceImpact) || 0,
      network_fee: Number(f.result?.microalgoTxnsFee) || 0,
      asset_in: fromASA,
      asset_out: toASA,
      amount,
      mode: 'folks',
      rawQuote: f,
    });
  } else {
    console.error('[getRankedQuotes] Folks failed:', results[1].reason);
  }

  if (quotes.length === 0) {
    throw new Error('All swap venues unavailable');
  }

  quotes.sort((a, b) => {
    if (b.amount_out !== a.amount_out) return b.amount_out - a.amount_out;
    return a.price_impact - b.price_impact;
  });

  return quotes;
}

export async function getBestQuote(fromASA: number, toASA: number, amount: number): Promise<AggregatorQuote> {
  const ranked = await getRankedQuotes(fromASA, toASA, amount);
  return ranked[0];
}

export async function prepareAggregatorSwap(
  rankedQuotes: AggregatorQuote[],
  sender: string,
  slippage: number
): Promise<{ transactions: string[]; usedAggregator: string }> {
  const failures: { aggregator: string; reason: string }[] = [];

  for (const quote of rankedQuotes) {
    try {
      if (quote.aggregator === 'vestige') {
        const { data } = await axios.post(
          'http://192.168.12.84/api/swap/vestige/transactions',
          quote.rawQuote,
          {
            params: { sender, slippage },
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
          }
        );
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('Vestige returned empty transaction group');
        }
        const transactions = data.map((entry: any) =>
          typeof entry === 'string' ? entry : entry?.txn
        ).filter((t: any): t is string => typeof t === 'string');
        return { transactions, usedAggregator: 'vestige' };
      }

      if (quote.aggregator === 'folks') {
        const { data } = await axios.post(
          'http://192.168.12.84/api/swap/folks/prepare',
          {
            senderAddr: sender,
            slippageBps: Math.round(slippage * 10000),
            txnPayload: quote.rawQuote.result?.txnPayload,
          },
          {
            timeout: 15000,
            headers: { 'Content-Type': 'application/json' },
          }
        );
        if (!data.success || !Array.isArray(data.result) || data.result.length === 0) {
          throw new Error(data.message || 'Folks returned empty transaction group');
        }
        const transactions = data.result.filter((t: any): t is string => typeof t === 'string');
        return { transactions, usedAggregator: 'folks' };
      }

      throw new Error(`Unknown aggregator: ${quote.aggregator}`);
    } catch (err: any) {
      console.error('[prepareAggregatorSwap]', quote.aggregator, 'failed:', err.message);
      failures.push({ aggregator: quote.aggregator, reason: err.message || String(err) });
    }
  }

  const summary = failures.map(f => `${f.aggregator}: ${f.reason}`).join('; ');
  const err = new Error(`TX_PREP_FAILED — ${summary}`);
  (err as any).aggregatorErrors = failures;
  throw err;
}
