'use server';
import mongoose from 'mongoose';

export interface Device extends mongoose.Document {
  _id: string;
  user_id: string;
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
  is_registered: boolean;
  staked?: {
    type: string;
    amount: number;
    time: Date;
    txId: string;
    asset_id: string;
    withdraw_boost: boolean;
    rewarded_time?: Date;
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
  createdAt: Date;
}

export interface FryToken extends mongoose.Document {
  name: string;
  asset_id: string;
}
