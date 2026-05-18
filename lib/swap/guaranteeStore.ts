/**
 * Guarantee event store — MongoDB adapter using existing mongoclient connection.
 *
 * Stores quote-commitment and swap-outcome telemetry events for auditing.
 * Outcome data is CLIENT-REPORTED and non-authoritative.
 * This module performs NO payouts, NO signing, NO user-facing changes.
 */
import clientPromise from '../mongoclient';

const DB_NAME = 'main';
const COLLECTION = 'guaranteeEvents';

export interface QuoteCommitment {
  type: 'quote_commitment';
  quoteId: string;              // immutable unique identifier
  status: 'pending' | 'consumed'; // G4 prep: consumed after outcome reported
  lockTimestamp: number;        // ms since epoch — when quote was fetched
  expiryTimestamp: number;      // lockTimestamp + QUOTE_TTL_MS
  inputAsset: number;           // ASA ID (0 = ALGO)
  inputAmount: number;          // base units
  outputAsset: number;          // target ASA ID
  rawAmountOut: number;         // amount_out from Vestige before slippage
  committedAmount: number;      // floor(rawAmountOut * (1 - slippagePct/100))
  slippagePct: number;          // e.g. 1.0 for 1%
  vestigeMode: string;          // e.g. 'sef'
  userAddress: string;
  priceImpact: number;
  networkFee: number;
  assetInPrice: number;
  assetOutPrice: number;
  createdAt: Date;
}

export interface SwapOutcome {
  type: 'swap_outcome';
  quoteId: string;                    // correlates to QuoteCommitment
  outcomeSource: 'client_report';     // marks data as untrusted client telemetry
  userAddress: string;
  outputAsset: number;
  clientReportedPreBalance: number;   // client-observed pre-swap balance (base units)
  clientReportedPostBalance: number;  // client-observed post-swap balance (base units)
  clientReportedReceived: number;     // post - pre (computed server-side from client data)
  tentativeShortfall: number;         // max(0, committedAmount - clientReportedReceived) — non-authoritative
  swapTxnIds: string[];
  confirmedRound: number;
  timestamp: number;
  createdAt: Date;
}

export type GuaranteeEvent = QuoteCommitment | SwapOutcome;

async function getCollection() {
  const client = await clientPromise;
  const db = client.db(DB_NAME);
  return db.collection<GuaranteeEvent>(COLLECTION);
}

export async function recordGuaranteeEvent(event: GuaranteeEvent): Promise<void> {
  const col = await getCollection();
  await col.insertOne({ ...event, createdAt: new Date() });
}

export async function getCommitmentByQuoteId(quoteId: string): Promise<QuoteCommitment | null> {
  const col = await getCollection();
  return col.findOne({ type: 'quote_commitment', quoteId }) as Promise<QuoteCommitment | null>;
}

export async function getOutcomeByQuoteId(quoteId: string): Promise<SwapOutcome | null> {
  const col = await getCollection();
  return col.findOne({ type: 'swap_outcome', quoteId }) as Promise<SwapOutcome | null>;
}

export async function markCommitmentConsumed(quoteId: string): Promise<void> {
  const col = await getCollection();
  await col.updateOne(
    { type: 'quote_commitment', quoteId },
    { $set: { status: 'consumed' } }
  );
}
