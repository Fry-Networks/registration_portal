/**
 * Retry wrapper for Algorand network operations.
 * 
 * Implements exponential backoff for transient network errors.
 * Does NOT retry on client errors (4xx) or transaction-related operations.
 */

type RetryableError = Error & {
  status?: number;
  statusCode?: number;
  code?: string;
  response?: { status?: number };
};

/**
 * Determines if an error is retryable (network/server error, not client error)
 */
function isRetryableError(error: unknown): boolean {
  const err = error as RetryableError;
  
  // Check for network-level errors
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') {
    return true;
  }
  
  // Check error message for fetch failures
  const message = err.message?.toLowerCase() ?? '';
  if (message.includes('fetch failed') || message.includes('network') || message.includes('timeout')) {
    return true;
  }
  
  // Check HTTP status codes
  const status = err.status ?? err.statusCode ?? err.response?.status;
  if (status) {
    // Retry on 5xx server errors and 429 rate limiting
    if (status >= 500 || status === 429) {
      return true;
    }
    // Do NOT retry on 4xx client errors (except 429)
    if (status >= 400 && status < 500) {
      return false;
    }
  }
  
  return false;
}

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry'>> = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 8000,
};

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute an async operation with exponential backoff retry.
 * 
 * @example
 * const balance = await withRetry(
 *   () => algodClient.accountInformation(address).do(),
 *   { maxAttempts: 3 }
 * );
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const { maxAttempts, initialDelayMs, maxDelayMs } = { ...DEFAULT_OPTIONS, ...options };
  const { onRetry } = options ?? {};
  
  let lastError: unknown;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Don't retry on last attempt or non-retryable errors
      if (attempt >= maxAttempts || !isRetryableError(error)) {
        throw error;
      }
      
      // Calculate delay with exponential backoff: 1s, 2s, 4s, ...
      const delayMs = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      
      // Log retry attempt
      console.warn(
        `[withRetry] Attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms:`,
        error instanceof Error ? error.message : String(error)
      );
      
      // Notify callback if provided
      onRetry?.(attempt, error, delayMs);
      
      await sleep(delayMs);
    }
  }
  
  // Should never reach here, but TypeScript needs this
  throw lastError;
}

/**
 * Wrap an Algorand API call with retry logic.
 * Convenience wrapper for the common algosdk .do() pattern.
 * 
 * @example
 * const accountInfo = await withAlgorandRetry(
 *   algodClient.accountInformation(address)
 * );
 */
export async function withAlgorandRetry<T>(
  request: { do: () => Promise<T> },
  options?: RetryOptions
): Promise<T> {
  return withRetry(() => request.do(), options);
}

export default withRetry;
