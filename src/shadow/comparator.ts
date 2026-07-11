/**
 * Invariant comparator.
 * Performs exact metric comparisons with no tolerance or approximation.
 */

import { Invariant } from '../intent/schema.js';
import { CollectedMetrics } from './metrics.js';

export interface InvariantViolation {
  invariant_name: string;
  metric_path: string;
  expected: string;
  actual: number;
  operator: string;
  threshold: number;
}

/**
 * Compares metrics against invariants.
 * Returns violations - empty array means all invariants satisfied.
 */
export function compareInvariants(
  metrics: CollectedMetrics,
  invariants: Invariant[],
  testInputs: Array<{ key: string }>
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  for (const invariant of invariants) {
    const value = getMetricValue(metrics, invariant.metric_path, testInputs);
    
    if (value === null) {
      // Metric not found - this is a validation error, not a violation
      continue;
    }

    const passes = evaluateComparison(value, invariant.operator, invariant.threshold);
    
    if (!passes) {
      violations.push({
        invariant_name: invariant.name,
        metric_path: invariant.metric_path,
        expected: `${invariant.operator} ${invariant.threshold}`,
        actual: value,
        operator: invariant.operator,
        threshold: invariant.threshold
      });
    }
  }

  return violations;
}

/**
 * Gets metric value from collected metrics.
 */
function getMetricValue(
  metrics: CollectedMetrics,
  metricPath: string,
  testInputs: Array<{ key: string }>
): number | null {
  if (metricPath.startsWith('token_count.')) {
    const key = metricPath.substring('token_count.'.length);
    return metrics.token_count[key] ?? null;
  }

  switch (metricPath) {
    case 'allow_count': {
      // Sum all allow counts for all keys
      let total = 0;
      for (const key of Object.keys(metrics.allow_count)) {
        total += metrics.allow_count[key] || 0;
      }
      return total;
    }
    case 'deny_count': {
      // Sum all deny counts for all keys
      let total = 0;
      for (const key of Object.keys(metrics.deny_count)) {
        total += metrics.deny_count[key] || 0;
      }
      return total;
    }
    case 'key_count':
      return metrics.key_count;
    case 'memory_bytes':
      return metrics.memory_bytes;
    default:
      return null;
  }
}

/**
 * Evaluates a comparison: value operator threshold
 * Exact comparison - no tolerance.
 */
function evaluateComparison(value: number, operator: string, threshold: number): boolean {
  switch (operator) {
    case 'lt':
      return value < threshold;
    case 'le':
      return value <= threshold;
    case 'eq':
      return value === threshold;
    case 'ge':
      return value >= threshold;
    case 'gt':
      return value > threshold;
    case 'ne':
      return value !== threshold;
    default:
      return false;
  }
}

/**
 * Compares baseline and patched metrics to detect new violations.
 * Used for 'moderate' risk tolerance.
 */
export function compareBaselineAndPatched(
  baselineMetrics: CollectedMetrics,
  patchedMetrics: CollectedMetrics,
  invariants: Invariant[],
  testInputs: Array<{ key: string }>
): InvariantViolation[] {
  const baselineViolations = compareInvariants(baselineMetrics, invariants, testInputs);
  const patchedViolations = compareInvariants(patchedMetrics, invariants, testInputs);

  // For moderate risk tolerance, only report violations that are new in patched
  // (baseline passes but patched fails)
  const baselineViolationSet = new Set(
    baselineViolations.map(v => v.invariant_name)
  );

  return patchedViolations.filter(v => !baselineViolationSet.has(v.invariant_name));
}

