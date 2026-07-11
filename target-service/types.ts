/**
 * Shared types for rate limiter service.
 */

export interface RateLimiterConfig {
  capacity: number;
  refillRate: number; // tokens per second
}

export interface Metrics {
  allow_count: Record<string, number>;
  deny_count: Record<string, number>;
  token_count: Record<string, number>;
  key_count: number;
  memory_bytes: number;
}

