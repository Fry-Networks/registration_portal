import mongoose, { Schema, Document } from 'mongoose';

export type EventStatus = 'draft' | 'active' | 'ended' | 'cancelled';
export type MetricType = 'manual' | 'aem_count' | 'device_count';
export type RefreshStatus = 'ok' | 'skipped' | 'failed';
export type LeaderboardSource = 'manual' | 'hardwareapi';

export interface IEvent extends Document {
  name: string;
  description?: string;
  status: EventStatus;
  startDate: Date;
  endDate: Date;
  prize: {
    type: string;
    amount: number;
    description?: string;
    paidTxId?: string;
  };
  metric: {
    type: MetricType;
    config?: Record<string, unknown>;
    lastRefreshAt?: Date;
    lastRefreshStatus?: RefreshStatus;
    lastRefreshError?: string;
  };
  leaderboard: Array<{
    wallet: string;
    score: number;
    lastCalculated?: Date;
    source?: LeaderboardSource;
  }>;
  winner?: {
    wallet?: string;
    score?: number;
    declaredAt?: Date;
    declaredBy?: string;
    prizeTxId?: string;
  };
  bannerImage?: string;
  ctaLink?: string;
  audience?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

const EventSchema = new Schema<IEvent>(
  {
    name: { type: String, required: true },
    description: { type: String },
    status: {
      type: String,
      enum: ['draft', 'active', 'ended', 'cancelled'],
      default: 'draft',
      required: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    prize: {
      type: { type: String, required: true },
      amount: { type: Number, required: true },
      description: { type: String },
      paidTxId: { type: String },
    },
    metric: {
      type: {
        type: String,
        enum: ['manual', 'aem_count', 'device_count'],
        default: 'manual',
        required: true,
      },
      config: { type: Schema.Types.Mixed },
      lastRefreshAt: { type: Date },
      lastRefreshStatus: { type: String, enum: ['ok', 'skipped', 'failed'] },
      lastRefreshError: { type: String },
    },
    leaderboard: [
      {
        wallet: { type: String, required: true },
        score: { type: Number, required: true, min: 0 },
        lastCalculated: { type: Date },
        source: { type: String, enum: ['manual', 'hardwareapi'] },
      },
    ],
    winner: {
      wallet: { type: String },
      score: { type: Number },
      declaredAt: { type: Date },
      declaredBy: { type: String },
      prizeTxId: { type: String },
    },
    bannerImage: { type: String },
    ctaLink: { type: String },
    audience: { type: String },
    created_by: { type: String },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'events',
  }
);

EventSchema.index({ status: 1 });
EventSchema.index({ startDate: 1, endDate: 1 });
EventSchema.index({ 'metric.type': 1 });
EventSchema.index({ 'leaderboard.wallet': 1 });
EventSchema.index({ 'winner.wallet': 1 });

export default mongoose.models.Event || mongoose.model<IEvent>('Event', EventSchema);
