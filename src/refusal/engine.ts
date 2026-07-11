/**
 * Refusal engine - main logic for accepting or refusing changes.
 * No suggestions are generated - only factual refusal reasons.
 */

import { Intent, RiskTolerance } from '../intent/schema.js';
import { ValidationError } from '../intent/validator.js';
import { CollectedMetrics } from '../shadow/metrics.js';
import { InvariantViolation, compareInvariants, compareBaselineAndPatched } from '../shadow/comparator.js';
import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

export interface RefusalResult {
  accepted: boolean;
  reason?: string;
  violations: Array<{
    type: 'intent' | 'scope' | 'invariant' | 'ambiguity';
    details: string;
  }>;
}

/**
 * Main refusal logic - determines if changes should be accepted.
 */
export function evaluateRefusal(
  intent: Intent,
  validationErrors: ValidationError[],
  baselineMetrics: CollectedMetrics,
  patchedMetrics: CollectedMetrics,
  baselineSuccess: boolean,
  patchedSuccess: boolean
): RefusalResult {
  const violations: Array<{ type: 'intent' | 'scope' | 'invariant' | 'ambiguity'; details: string }> = [];

  // Check validation errors
  if (validationErrors.length > 0) {
    for (const error of validationErrors) {
      violations.push({
        type: error.type,
        details: error.details
      });
    }
    return {
      accepted: false,
      reason: 'Intent validation failed',
      violations
    };
  }

  // Check execution success
  if (!baselineSuccess) {
    return {
      accepted: false,
      reason: 'Baseline execution failed',
      violations: [{
        type: 'intent',
        details: 'Baseline code failed to execute'
      }]
    };
  }

  if (!patchedSuccess) {
    return {
      accepted: false,
      reason: 'Patched execution failed',
      violations: [{
        type: 'intent',
        details: 'Patched code failed to execute'
      }]
    };
  }

  // Check scope violations
  const scopeViolations = checkScopeViolations(intent.scope);
  if (scopeViolations.length > 0) {
    violations.push(...scopeViolations);
    return {
      accepted: false,
      reason: 'Scope violations detected',
      violations
    };
  }

  // Check invariants based on risk tolerance
  const testInputs = intent.test_inputs;
  let invariantViolations: InvariantViolation[] = [];

  if (intent.risk_tolerance === 'strict') {
    // Any violation = refusal
    invariantViolations = compareInvariants(patchedMetrics, intent.invariants, testInputs);
  } else if (intent.risk_tolerance === 'moderate') {
    // Only new violations (baseline passes, patched fails)
    invariantViolations = compareBaselineAndPatched(
      baselineMetrics,
      patchedMetrics,
      intent.invariants,
      testInputs
    );
  } else {
    // permissive - but MVP still refuses all violations
    invariantViolations = compareInvariants(patchedMetrics, intent.invariants, testInputs);
  }

  if (invariantViolations.length > 0) {
    for (const violation of invariantViolations) {
      violations.push({
        type: 'invariant',
        details: `Invariant '${violation.invariant_name}' violated: ${violation.metric_path} = ${violation.actual}, expected ${violation.expected}`
      });
    }
    return {
      accepted: false,
      reason: 'Invariant violations detected',
      violations
    };
  }

  // All checks passed
  return {
    accepted: true,
    violations: []
  };
}

/**
 * Checks for scope violations by comparing declared scope with actual file changes.
 * This is a simplified check - in production, would use AST diffing.
 */
function checkScopeViolations(scope: { files: string[]; functions: string[] }): Array<{ type: 'scope'; details: string }> {
  const violations: Array<{ type: 'scope'; details: string }> = [];
  const patchedDir = 'target-service/patched';

  if (!existsSync(patchedDir)) {
    return violations;
  }

  // Get all files in patched directory
  const filesInPatched = getAllFiles(patchedDir);

  // Check if any files exist that aren't in scope
  for (const file of filesInPatched) {
    const relativePath = file.replace(/\\/g, '/');
    const inScope = scope.files.some(scopeFile => {
      // Normalize paths for comparison
      const normalizedScope = scopeFile.replace(/\\/g, '/');
      return relativePath === normalizedScope || relativePath.endsWith(normalizedScope);
    });

    if (!inScope) {
      violations.push({
        type: 'scope',
        details: `File '${relativePath}' exists in patched directory but not in scope. Scope only allows: ${scope.files.join(', ')}`
      });
    }
  }

  return violations;
}

/**
 * Recursively get all files in a directory.
 */
function getAllFiles(dir: string): string[] {
  const files: string[] = [];
  
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...getAllFiles(fullPath));
      } else if (stat.isFile()) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Ignore errors
  }

  return files;
}

