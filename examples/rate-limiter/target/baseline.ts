/**
 * Baseline token-bucket rate limiter — the immutable reference implementation.
 * Migrated from the original target-service/baseline/rate-limiter.ts. The
 * `now()` injection makes the property tests deterministic.
 */

export interface RateLimiterConfig {
  capacity: number;
  refillRate: number; // tokens per second
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets = new Map<string, TokenBucket>();
  constructor(
    private readonly config: RateLimiterConfig,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  allow(key: string): boolean {
    const bucket = this.getBucket(key);
    this.refill(bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  getRemaining(key: string): number {
    const bucket = this.getBucket(key);
    this.refill(bucket);
    return Math.floor(bucket.tokens);
  }

  private getBucket(key: string): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.config.capacity, lastRefill: this.clock() };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  private refill(bucket: TokenBucket): void {
    const now = this.clock();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.config.capacity,
      bucket.tokens + elapsed * this.config.refillRate,
    );
    bucket.lastRefill = now;
  }

  getKeys(): string[] {
    return [...this.buckets.keys()];
  }
}
