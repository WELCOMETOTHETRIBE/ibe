/**
 * Patched rate limiter implementation.
 * This is the proposed changes version.
 * For MVP, starts as a copy of baseline.
 */

import { RateLimiterConfig } from '../types.js';

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket>;
  private config: RateLimiterConfig;

  constructor(config: RateLimiterConfig) {
    this.config = config;
    this.buckets = new Map();
  }

  /**
   * Check if a request should be allowed.
   * Returns true if tokens are available, false otherwise.
   */
  allow(key: string): boolean {
    // BUG: Always allow requests - violates rate limiting
    const bucket = this.getBucket(key);
    this.refill(bucket);
    
    // Intentionally broken: always return true, ignoring token count
    return true;
  }

  /**
   * Get remaining tokens for a key.
   */
  getRemaining(key: string): number {
    const bucket = this.getBucket(key);
    this.refill(bucket);
    return Math.floor(bucket.tokens);
  }

  /**
   * Get or create a token bucket for a key.
   */
  private getBucket(key: string): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: this.config.capacity,
        lastRefill: Date.now()
      };
      this.buckets.set(key, bucket);
    }
    return bucket;
  }

  /**
   * Refill tokens based on elapsed time.
   */
  private refill(bucket: TokenBucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000; // Convert to seconds
    const tokensToAdd = elapsed * this.config.refillRate;
    
    bucket.tokens = Math.min(
      this.config.capacity,
      bucket.tokens + tokensToAdd
    );
    bucket.lastRefill = now;
  }

  /**
   * Get all keys in the rate limiter (for metrics).
   */
  getKeys(): string[] {
    return Array.from(this.buckets.keys());
  }

  /**
   * Get internal state size for memory estimation.
   */
  getStateSize(): number {
    let size = 0;
    for (const [key, bucket] of this.buckets.entries()) {
      size += key.length * 2; // UTF-16 encoding
      size += 24; // Approximate size for bucket object (tokens: number, lastRefill: number)
    }
    return size;
  }
}

