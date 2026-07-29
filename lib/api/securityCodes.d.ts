export declare const BLOCKING_SECURITY_CODES: Set<string>;
export declare const RETRYABLE_SECURITY_CODES: Set<string>;
export declare const TERMINAL_BATCH_STATUSES: Set<number>;
export declare function isSecurityBlockCode(code?: string | null): boolean;
export declare function isRetryableSecurityCode(code?: string | null): boolean;
export declare function shouldFallBackPerDevice(
  error?: { status?: number; code?: string } | null
): boolean;
