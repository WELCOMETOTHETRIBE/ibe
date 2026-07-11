/**
 * Shadow execution engine.
 * Runs baseline and patched versions in isolated child processes.
 */

import { TestInput } from '../intent/schema.js';
import { CollectedMetrics, trackAllowResult } from './metrics.js';

export interface ExecutionResult {
  metrics: CollectedMetrics;
  success: boolean;
  error?: string;
}

/**
 * Executes a rate limiter version (baseline or patched) in a child process.
 */
export async function executeVersion(
  version: 'baseline' | 'patched',
  testInputs: TestInput[],
  config: { capacity: number; refillRate: number }
): Promise<ExecutionResult> {
  // For MVP, execute in-process
  // In production, this would use child_process.spawn for true isolation
  return executeInProcess(version, testInputs, config);
}

/**
 * Execute in-process (simplified for MVP).
 * In production, this would use child_process.spawn for true isolation.
 */
async function executeInProcess(
  version: 'baseline' | 'patched',
  testInputs: TestInput[],
  config: { capacity: number; refillRate: number }
): Promise<ExecutionResult> {
  try {
    // Dynamically import the rate limiter
    const modulePath = version === 'baseline'
      ? '../../target-service/baseline/rate-limiter.js'
      : '../../target-service/patched/rate-limiter.js';
    
    const module = await import(modulePath);
    const RateLimiter = module.RateLimiter;
    const rateLimiter = new RateLimiter(config);

    // Initialize metrics
    const executedKeys = new Set<string>();
    const metrics: CollectedMetrics = {
      allow_count: {},
      deny_count: {},
      token_count: {},
      key_count: 0,
      memory_bytes: 0
    };

    // Execute test inputs with timing
    let lastTimestamp = 0;
    for (const input of testInputs) {
      const timestamp = input.timestamp_ms ?? lastTimestamp;
      const delay = Math.max(0, timestamp - lastTimestamp);
      
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      executedKeys.add(input.key);

      if (input.action === 'allow') {
        const allowed = rateLimiter.allow(input.key);
        trackAllowResult(metrics, input.key, allowed);
      } else if (input.action === 'getRemaining') {
        // Just call to ensure refill happens, but don't track as metric here
        rateLimiter.getRemaining(input.key);
      }

      lastTimestamp = timestamp;
    }

    // Collect final metrics
    const allKeys = rateLimiter.getKeys();
    for (const key of allKeys) {
      // Collect token count for all keys
      metrics.token_count[key] = rateLimiter.getRemaining(key);
    }
    metrics.key_count = allKeys.length;
    metrics.memory_bytes = rateLimiter.getStateSize();

    // Ensure all executed keys have entries in allow/deny counts (even if 0)
    for (const key of executedKeys) {
      if (!metrics.allow_count[key]) {
        metrics.allow_count[key] = 0;
      }
      if (!metrics.deny_count[key]) {
        metrics.deny_count[key] = 0;
      }
    }

    return {
      metrics,
      success: true
    };
  } catch (error) {
    return {
      metrics: {
        allow_count: {},
        deny_count: {},
        token_count: {},
        key_count: 0,
        memory_bytes: 0
      },
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Run shadow execution: execute both baseline and patched versions.
 */
export async function runShadowExecution(
  testInputs: TestInput[],
  config: { capacity: number; refillRate: number }
): Promise<{ baseline: ExecutionResult; patched: ExecutionResult }> {
  // Execute both versions (in MVP, sequentially; in production, parallel)
  const baseline = await executeVersion('baseline', testInputs, config);
  const patched = await executeVersion('patched', testInputs, config);

  return { baseline, patched };
}

