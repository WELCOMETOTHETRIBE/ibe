/**
 * Formal-check driver. Runs the capability and promotion models in both their
 * correct and deliberately-broken forms. The gate passes iff:
 *   - every CORRECT model has zero invariant violations, AND
 *   - every BROKEN model is CAUGHT (has at least one violation).
 * This is the §14 requirement: a test demonstrating that a deliberately unsafe
 * state transition is detected.
 */

import { checkModel, type ModelCheckResult } from './transition-system.js';
import { capabilitySystem } from './capability-spec.js';
import { promotionSystem } from './promotion-spec.js';

export interface FormalReport {
  results: Array<ModelCheckResult & { expected: 'safe' | 'unsafe-caught'; pass: boolean }>;
  ok: boolean;
}

export function runFormalChecks(): FormalReport {
  const specs: Array<{ result: ModelCheckResult; expected: 'safe' | 'unsafe-caught' }> = [
    { result: checkModel(capabilitySystem(false)), expected: 'safe' },
    { result: checkModel(capabilitySystem(true)), expected: 'unsafe-caught' },
    { result: checkModel(promotionSystem(false)), expected: 'safe' },
    { result: checkModel(promotionSystem(true)), expected: 'unsafe-caught' },
  ];

  const results = specs.map(({ result, expected }) => {
    const pass = expected === 'safe' ? result.ok : !result.ok; // unsafe models must be caught
    return { ...result, expected, pass };
  });

  return { results, ok: results.every((r) => r.pass) };
}
