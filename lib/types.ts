"use server"
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
      time: string;
      txId: string;
    }
    hexId?: string;
    address: string;
    email: string;
    __v: number;
  }