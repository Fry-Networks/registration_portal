type Key = string;

class SimpleRateLimiter {
  private tokens: Map<Key, { lastRefill: number; tokens: number }> = new Map();
  private capacity: number;
  private refillMs: number;

  constructor(capacity = 10, refillMs = 1000) {
    this.capacity = capacity;
    this.refillMs = refillMs;
  }

  take(key: Key, amount = 1): boolean {
    const now = Date.now();
    const entry = this.tokens.get(key) || { lastRefill: now, tokens: this.capacity };
    const elapsed = now - entry.lastRefill;
    const refill = Math.floor(elapsed / this.refillMs);
    if (refill > 0) {
      entry.tokens = Math.min(this.capacity, entry.tokens + refill);
      entry.lastRefill = entry.lastRefill + refill * this.refillMs;
    }

    if (entry.tokens >= amount) {
      entry.tokens -= amount;
      this.tokens.set(key, entry);
      return true;
    }

    this.tokens.set(key, entry);
    return false;
  }
}

const globalLimiter = new SimpleRateLimiter(5, 1000); // 5 requests per second per key

export function rateLimitMiddleware(key: string) {
  return (req: any, res: any) => {
    if (!globalLimiter.take(key)) {
      res.status(429).json({ message: 'Too many requests; slow down.' });
      return false;
    }
    return true;
  };
}

export default globalLimiter;
