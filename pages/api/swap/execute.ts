import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';
import axios from 'axios';
import algosdk from 'algosdk';
import { isInstrumentationEnabled, recordQuoteCommitment } from '../../../lib/swap/guaranteeInstrumentation';

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

    // Vestige returns an array of objects with a 'txn' field (base64 string)
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(502).json({ success: false, error: 'Vestige returned empty transaction group' });
    }

    const transactions = data.map((entry: any) =>
      typeof entry === 'string' ? entry : entry?.txn
    ).filter((t: any): t is string => typeof t === 'string');

    if (transactions.length === 0) {
      return res.status(502).json({ success: false, error: 'No valid transactions returned from Vestige' });
    }

    // Instrumentation: generate quoteId and record commitment (disabled by default)
    let quoteId: string | undefined;
    if (isInstrumentationEnabled()) {
      quoteId = crypto.randomUUID();
      recordQuoteCommitment({ quoteId, quote, sender, slippage: slippage || 1 }).catch(() => {});
    }

    return res.status(200).json({
      success: true,
      transactions,
      ...(quoteId !== undefined && { quoteId }),
    });
  } catch (err: any) {
    const status = err.response?.status || 502;
    const message = err.response?.data?.message || err.response?.data?.error || err.message || 'Swap preparation failed';
    console.error('[swap/execute]', { status, message, body: req.body });
    return res.status(status).json({ success: false, error: message });
  }
}
