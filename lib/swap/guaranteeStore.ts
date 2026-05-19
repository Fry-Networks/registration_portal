/**
 * Guarantee event store - MongoDB adapter using existing mongoclient connection.
 *
 * Stores quote-commitment, swap-outcome, and settlement records.
 * Extended for guarantee feature: settlement tracking, daily caps, order hash.
 */
import crypto from 'crypto';
import clientPromise from '../mongoclient';

const DB_NAME = 'main';
const COLLECTION = 'guaranteeEvents';

export interface QuoteCommitment {
  type: 'quote_commitment';
  quoteId: string;
  status: 'pending' | 'consumed';
  lockTimestamp: number;
  expiryTimestamp: number;
  swapSubmissionDeadline: number;
  settlementDeadline: number;
  inputAsset: number;
  inputAmount: number;
  outputAsset: number;
  rawAmountOut: number;
  guaranteedAmount: number;
  estimatedAmount: number;
  slippagePct: number;
  vestigeMode: string;
  userAddress: string;
  priceImpact: number;
  networkFee: number;
  assetInPrice: number;
  assetOutPrice: number;
  guaranteeEligible: boolean;
  guaranteeReason?: string;
  routeLiquidityUsd: number;
  liquiditySource: string;
  orderHash?: string;
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
  settlementStatus?: 'pending' | 'settled' | 'skipped' | 'failed' | 'ineligible';
  settlementTxId?: string;
  settlementAmount?: number;
  settlementTimestamp?: number;
  settlementError?: string;
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

export async function updateOutcomeSettlement(
  quoteId: string,
  fields: Partial<Pick<SwapOutcome,
    'settlementStatus' | 'settlementTxId' | 'settlementAmount' |
    'settlementTimestamp' | 'settlementError'
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

/**
 * Sum settled amounts for a wallet in a UTC day window (for per-wallet/day cap).
 */
export async function getDailyWalletTopup(
  walletAddress: string,
  dayStartMs: number,
  dayEndMs: number
): Promise<number> {
  const col = await getCollection();
  const results = await col.aggregate([
    {
      $match: {
        type: 'swap_outcome',
        userAddress: walletAddress,
        settlementStatus: 'settled',
        settlementTimestamp: { $gte: dayStartMs, $lt: dayEndMs },
      },
    },
    { $group: { _id: null, total: { $sum: '$settlementAmount' } } },
  ]).toArray();
  return results[0]?.total || 0;
}

/**
 * Sum all settled amounts globally in a UTC day window (for global/day cap).
 */
export async function getDailyGlobalTopup(
  dayStartMs: number,
  dayEndMs: number
): Promise<number> {
  const col = await getCollection();
  const results = await col.aggregate([
    {
      $match: {
        type: 'swap_outcome',
        settlementStatus: 'settled',
        settlementTimestamp: { $gte: dayStartMs, $lt: dayEndMs },
      },
    },
    { $group: { _id: null, total: { $sum: '$settlementAmount' } } },
  ]).toArray();
  return results[0]?.total || 0;
}

/**
 * Compute bound settlement order hash.
 * SHA256(quoteId || walletAddress || targetAssetId || guaranteedAmount || settlementDeadline)
 */
export function computeOrderHash(params: {
  quoteId: string;
  walletAddress: string;
  targetAssetId: number;
  guaranteedAmount: number;
  settlementDeadline: number;
}): string {
  const h = crypto.createHash('sha256');
  h.update(params.quoteId);
  h.update(params.walletAddress);
  h.update(params.targetAssetId.toString());
  h.update(params.guaranteedAmount.toString());
  h.update(params.settlementDeadline.toString());
  return h.digest('hex');
}

/** Get UTC day boundaries for cap checks. */
export function getUtcDayBounds(): { start: number; end: number } {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start, end: start + 86_400_000 };
}
