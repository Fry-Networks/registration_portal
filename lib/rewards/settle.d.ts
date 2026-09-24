export interface SettleRecord { source: string; reward_number: number; amount: number; asset_id?: string | number; [k: string]: any }
export interface SettleIssue { code: string; count: number; items: any[] }
export interface SettleResult { settled: number; alreadySettled: number; clean: boolean; issues: SettleIssue[] }
export declare const NON_BLOCKING: Set<string>;
export declare function effectiveAmount(row: any): number;
export declare function micro(v: any): number;
export declare function pinFor(e: any, source: 'weekly' | 'daily', status: string, groupId: string | null): Record<string, any>;
export declare function elemMatches(e: any, pin: Record<string, any>): boolean;
export declare function planSettle(
  doc: any,
  opts: { txId: string; records: SettleRecord[]; groupId?: string; selected?: any[] }
): { chosen: Map<any, { source: 'weekly' | 'daily'; amount: number; status: string; group: string | null }>; alreadySettled: number; issues: Map<string, any[]> };
export declare function settleRows(
  rewardsCollection: any,
  opts: { minerKey: string; txId: string; claimedAt: Date; records: SettleRecord[]; groupId?: string; selected?: any[] }
): Promise<SettleResult>;
