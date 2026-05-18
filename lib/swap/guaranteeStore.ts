/**
 * Guarantee event store — MongoDB adapter using existing mongoclient connection.
 *
 * Stores quote-commitment and swap-outcome telemetry events for auditing.
 * Outcome data from clients is UNTRUSTED TELEMETRY until server-side verification.
 * This module performs NO payouts, NO signing, NO user-facing changes.
 */
import clientPromise from '../mongoclient';

const DB_NAME = 'main';
const COLLECTION = 'guaranteeEvents';

export interface QuoteCommitment {
  type: 'quote_commitment';
  quoteId: string;
  status: 'pending' | 'consumed';
  lockTimestamp: number;
  expiryTimestamp: number;
  inputAsset: number;
  inputAmount: number;
  outputAsset: number;
  rawAmountOut: number;
  committedAmount: number;
  slippagePct: number;
  vestigeMode: string;
  userAddress: string;
  priceImpact: number;
  networkFee: number;
  assetInPrice: number;
  assetOutPrice: number;
  createdAt: Date;
}

export interface InnerTxnEvidence {
  txId: string;
  type: string;
  assetId: number;
  amount: number;
  receiver: string;
  confirmedRound: number;
}

export interface SwapOutcome {
  type: 'swap_outcome';
  quoteId: string;
  outcomeSource: 'client_report';
  userAddress: string;
  outputAsset: number;
  clientReportedPreBalance: number;
  clientReportedPostBalance: number;
  clientReportedReceived: number;
  tentativeShortfall: number;
  swapTxnIds: string[];
  confirmedRound: number;
  timestamp: number;
  createdAt: Date;
  // Authoritative verification fields (populated by verify-outcome)
  verificationStatus?: 'pending' | 'verified' | 'failed' | 'discrepancy';
  authoritativeReceived?: number;
  authoritativeShortfall?: number;
  verificationSource?: 'indexer_lookup_by_id';
  verificationTimestamp?: number;
  verificationAttempts?: number;
  verificationError?: string;
  discrepancyAmount?: number;
  discrepancyFlag?: boolean;
  innerTxnEvidence?: InnerTxnEvidence[];
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

export async function updateOutcomeVerification(
  quoteId: string,
  fields: Partial<Pick<SwapOutcome,
    'verificationStatus' | 'authoritativeReceived' | 'authoritativeShortfall' |
    'verificationSource' | 'verificationTimestamp' | 'verificationAttempts' |
    'verificationError' | 'discrepancyAmount' | 'discrepancyFlag' | 'innerTxnEvidence'
  >>
): Promise<void> {
  const col = await getCollection();
  await col.updateOne(
    { type: 'swap_outcome', quoteId },
    { $set: fields }
  );
}

export async function getOutcomesByStatus(
  status: SwapOutcome['verificationStatus'],
  limit = 50
): Promise<SwapOutcome[]> {
  const col = await getCollection();
  return col.find({ type: 'swap_outcome', verificationStatus: status })
    .sort({ timestamp: 1 })
    .limit(limit)
    .toArray() as Promise<SwapOutcome[]>;
}
