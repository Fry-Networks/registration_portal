export interface RewardRecord { source: string; reward_number: number; [k: string]: any }
export declare const CLAIMABLE: string;
export declare const CLAIMING: string;
export declare const CLAIMED: string;
export declare const SETTLEABLE_FROM: string[];
export declare function numbersFor(records: RewardRecord[], source: string): number[];
export declare function reserveRows(rewardsCollection: any, minerKey: string, records: RewardRecord[], groupId: string, now?: Date): Promise<number>;
export declare function releaseRows(rewardsCollection: any, minerKey: string, records: RewardRecord[], groupId: string): Promise<void>;
export declare function mayReleaseExpiredReservation(evidence: { paid?: boolean | null }): boolean;
export declare function releaseStaleReservations(rewardsCollection: any, pendingCollection: any, minerKey: string): Promise<number>;
