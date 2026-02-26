/**
 * Client-side wallet request coordinator
 * This version provides compatibility for browser environments
 * where MongoDB and Node.js dependencies are not available.
 */

export class WalletRequestInFlightError extends Error {
  constructor() {
    super('Wallet request already in progress');
    this.name = 'WalletRequestInFlightError';
  }
}

// Client-side memory store for request tracking
// Note: This is local to the browser session and doesn't persist
const activeRequests = new Map<string, number>();

// Subscribers for reactive state updates
type Subscriber = () => void;
const subscribers = new Set<Subscriber>();

/**
 * Subscribe to pending state changes
 */
export const subscribeToWalletPending = (callback: Subscriber): (() => void) => {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
};

/**
 * Notify all subscribers of state change
 */
const notifySubscribers = (): void => {
  subscribers.forEach(callback => callback());
};

/**
 * Get the global pending state for UI components
 * Returns true if any wallet operation is currently active
 */
export const isAnyWalletRequestPending = (): boolean => {
  const now = Date.now();
  // Clean up expired entries and check if any are still active
  const entries = Array.from(activeRequests.entries());
  for (let i = 0; i < entries.length; i++) {
    const [key, timestamp] = entries[i];
    if (now - timestamp > 30000) {
      activeRequests.delete(key);
    } else {
      return true;
    }
  }
  return false;
};

/**
 * Client-side check for active wallet requests
 * Returns synchronously (unlike the server version)
 */
export const isWalletRequestActive = (
  address: string = 'global', 
  operation: string = 'wallet_operation'
): boolean => {
  const key = `${address}:${operation}`;
  const timestamp = activeRequests.get(key);
  
  if (!timestamp) return false;
  
  // Check if request has expired (30 second default TTL)
  const now = Date.now();
  if (now - timestamp > 30000) {
    activeRequests.delete(key);
    return false;
  }
  
  return true;
};

/**
 * Mark a wallet request as active (client-side only)
 */
export const markWalletRequestActive = (
  address: string = 'global',
  operation: string = 'wallet_operation'
): void => {
  const key = `${address}:${operation}`;
  activeRequests.set(key, Date.now());
  notifySubscribers();
};

/**
 * Clear an active wallet request (client-side only)
 */
export const clearWalletRequest = (
  address: string = 'global',
  operation: string = 'wallet_operation'
): void => {
  const key = `${address}:${operation}`;
  activeRequests.delete(key);
  notifySubscribers();
};

/**
 * Client-side wrapper that throws if a request is already active
 * This provides basic protection against double-clicks on the client
 */
export const runWithWalletRequest = async <T>(
  task: () => Promise<T>,
  options?: {
    address?: string;
    operation?: string;
  }
): Promise<T> => {
  const operation = options?.operation ?? 'wallet_operation';
  const address = options?.address ?? 'global';
  
  if (isWalletRequestActive(address, operation)) {
    throw new WalletRequestInFlightError();
  }
  
  markWalletRequestActive(address, operation);
  
  try {
    return await task();
  } finally {
    clearWalletRequest(address, operation);
  }
};
