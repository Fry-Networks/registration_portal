import mongoose, { Schema } from 'mongoose';

export interface Device extends mongoose.Document {
  _id: string;
  user_id: Schema.Types.ObjectId;
  nickname?: string;
  miner_key: string;
  name: string;
  byod?: string;
  created_at: Date;
  position?: {
    lat: number;
    lng: number;
  };
  verified: boolean;
  reward_wallet?: string;
  note?: string;
  is_registered: boolean;
  registered_portal_model?: string;
  staked?: {
    type: string;
    amount: number;
    time: Date;
    txId: string;
    asset_id: string;
    withdraw_boost: boolean;
    rewarded_time?: Date;
  };
  registration?: {
    amount: number;
    time: Date;
    txId: string;
    asset_id: string;
  };
  node?: {
    amount: number;
    time: Date;
    txId: string;
    asset_id: string;
  };
  names?: {
    first_name: string;
    last_name: string;
  };
  connectivity_wallet?: string;
  hexId?: string;
  address: string;
  email: string;
  __v: number;
}

export interface Reward extends mongoose.Document {
  no: number;
  miner_key: string;
  status: string;
  asset_id: string;
  amount: number;
  txId?: string;
  createdAt: Date;
  claimedAt?: Date;
}

export interface RewardBoost extends mongoose.Document {
  miner_key: string;
  address: string;
  rewards_nos: number[];
  fee_amount: number;
  asset_id: string;
  price: number;
  createdAt: Date;
  txID: string;
}

export interface FryToken extends mongoose.Document {
  name: string;
  asset_id: string;
}

export interface Product extends mongoose.Document {
  wix_id: string;
  name: string;
  key: string;
  reward: {
    unverified: number;
    verified: number;
    stake?: {
      stake_one: number;
      stake_two: number;
      register: number;
      node: number;
    };
    tokens?: {
      stake: string;
      reward: string;
      register: string;
      node: string;
    };
  };
  created_at: Date;
}

export type Asset = {
  id: string;
  decimals: number;
};

export interface FryConversion extends mongoose.Document {
  status: string;
  address: string;
  held: number;
  verification?: number;
  cometaStaking?: number;
  cometaLp?: number;
  tinymanLp?: number;
  amount: number;
  asset_id: string;
  claimableAmount: number;
  pendingAmount: number;
  claimableMonths: number;
  claimedMonths: number;
  ratio?: number[];
  history?: Array<{
    amount: number;
    tokenType: string;
    date: string;
  }>;
}
