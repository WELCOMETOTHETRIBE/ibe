/**
 * Metrics collection for shadow execution.
 * Collects minimal, exact metrics with no aggregation or derivation.
 */

import { Metrics } from '../../target-service/types.js';
import { RateLimiter } from '../../target-service/baseline/rate-limiter.js';

export interface CollectedMetrics {
  allow_count: Record<string, number>;
  deny_count: Record<string, number>;
  token_count: Record<string, number>;
  key_count: number;
  memory_bytes: number;
}

/**
 * Collects metrics from a rate limiter after execution.
 * All metrics are collected at end of execution - no continuous collection.
 */
export function collectMetrics(rateLimiter: RateLimiter, executedKeys: Set<string>): CollectedMetrics {
  const allow_count: Record<string, number> = {};
  const deny_count: Record<string, number> = {};
  const token_count: Record<string, number> = {};

  // Initialize counts for all executed keys
  for (const key of executedKeys) {
    allow_count[key] = 0;
    deny_count[key] = 0;
  }

  // Note: allow_count and deny_count are tracked during execution, not here
  // This function only collects final state metrics

  // Collect token counts for all keys
  const allKeys = rateLimiter.getKeys();
  for (const key of allKeys) {
    token_count[key] = rateLimiter.getRemaining(key);
  }

  // Collect key count
  const key_count = allKeys.length;

  // Estimate memory usage
  const memory_bytes = rateLimiter.getStateSize();

  return {
    allow_count,
    deny_count,
    token_count,
    key_count,
    memory_bytes
  };
}

/**
 * Updates allow/deny counts during execution.
 * This is called for each allow() call to track outcomes.
 */
export function trackAllowResult(
  metrics: CollectedMetrics,
  key: string,
  allowed: boolean
): void {
  if (!metrics.allow_count[key]) {
    metrics.allow_count[key] = 0;
  }
  if (!metrics.deny_count[key]) {
    metrics.deny_count[key] = 0;
  }

  if (allowed) {
    metrics.allow_count[key]++;
  } else {
    metrics.deny_count[key]++;
  }
}

