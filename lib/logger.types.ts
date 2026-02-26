export interface LogMetadata {
  [key: string]: any;
}

export interface ApiLogMetadata extends LogMetadata {
  endpoint: string;
  method?: string;
  statusCode?: number;
  duration?: number;
}

export interface StakeLogMetadata extends LogMetadata {
  miner_key: string;
  amount?: number;
  txId?: string;
  asset_id?: string;
}

export interface UserLogMetadata extends LogMetadata {
  address: string;
  action: string;
}

export interface DbLogMetadata extends LogMetadata {
  collection: string;
  operation: string;
  matchedCount?: number;
  modifiedCount?: number;
}

export type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'debug';

export interface ErrorLogMetadata extends LogMetadata {
  minerKey?: string;
  miner_key?: string;
  miner_keys?: unknown;
  walletAddress?: string;
  address?: string;
  walletAddresses?: unknown;
  wallet_addresses?: unknown;
  issueType?: string;
  errorType?: string;
  part?: string;
  step?: string;
  section?: string;
  detail?: string;
  message?: string;
}

export interface NormalizedErrorLogDetails {
  minerKey: string;
  walletAddress: string;
  issueType: string;
  part: string;
  detailMessage?: string;
  rawMetadata?: LogMetadata;
}
