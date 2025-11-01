export type StakeAction = 'staked' | 'withdrawn';

export interface StakeEvent {
  action: StakeAction;
  amount: number;
  txId: string;
  time: string;
  assetId?: string;
  lockType?: string;
}

export interface StakeHistoryMap {
  verification: StakeEvent[];
  registration: StakeEvent[];
  node: StakeEvent[];
}

export interface StakeFieldRecord {
  amount?: number;
  asset_id?: string;
  txId?: string;
  time?: string | number | Date;
  type?: string;
}

export interface StakeField extends StakeFieldRecord {
  history?: StakeFieldRecord[];
  withdrawals?: StakeFieldRecord[];
  lastWithdrawal?: StakeFieldRecord | null;
}

export function buildStakeEvents(source?: StakeField | null): StakeEvent[];

export function collectStakeHistory(device: any): StakeHistoryMap;

export const __private__: {
  toISOString: (input: unknown) => string | undefined;
  toFiniteNumber: (value: unknown) => number | undefined;
};
