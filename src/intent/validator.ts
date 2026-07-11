/**
 * Intent validator with explicit validation rules.
 * Prefers false negatives over false positives.
 */

import {
  Intent,
  AllowedVerb,
  FORBIDDEN_VAGUE_WORDS,
  MEASURABLE_OUTCOMES,
  AMBIGUOUS_WORDS,
  AVAILABLE_METRICS,
  MetricOperator
} from './schema.js';
import { existsSync, readFileSync } from 'fs';

export interface ValidationError {
  type: 'intent' | 'scope' | 'invariant' | 'ambiguity';
  details: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

/**
 * Validates an intent according to all hardened rules.
 */
export function validateIntent(intent: Intent): ValidationResult {
  const errors: ValidationError[] = [];

  // Validate goal
  const goalErrors = validateGoal(intent.goal);
  errors.push(...goalErrors);

  // Validate scope
  const scopeErrors = validateScope(intent.scope);
  errors.push(...scopeErrors);

  // Validate invariants
  const invariantErrors = validateInvariants(intent.invariants, intent.test_inputs);
  errors.push(...invariantErrors);

  // Validate risk tolerance
  const riskErrors = validateRiskTolerance(intent.risk_tolerance);
  errors.push(...riskErrors);

  // Validate test inputs
  const testInputErrors = validateTestInputs(intent.test_inputs);
  errors.push(...testInputErrors);

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Validates goal according to strict rules.
 */
function validateGoal(goal: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // Length check
  if (goal.length < 10 || goal.length > 200) {
    errors.push({
      type: 'intent',
      details: `Goal must be 10-200 characters, got ${goal.length}`
    });
    return errors; // Early return for length issues
  }

  // Must end with period
  if (!goal.endsWith('.')) {
    errors.push({
      type: 'intent',
      details: 'Goal must be a single sentence ending with period'
    });
  }

  // Must start with allowed verb
  const allowedVerbs: AllowedVerb[] = ['ensure', 'prevent', 'maintain', 'enforce', 'guarantee', 'preserve'];
  const lowerGoal = goal.toLowerCase();
  const startsWithVerb = allowedVerbs.some(verb => lowerGoal.startsWith(verb));
  if (!startsWithVerb) {
    errors.push({
      type: 'intent',
      details: `Goal must start with allowed verb (ensure, prevent, maintain, enforce, guarantee, preserve). Got: "${goal.substring(0, 20)}..."`
    });
  }

  // Check for forbidden vague words
  for (const word of FORBIDDEN_VAGUE_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(goal)) {
      errors.push({
        type: 'intent',
        details: `Goal contains forbidden vague word: '${word}'`
      });
    }
  }

  // Check for ambiguous words
  for (const word of AMBIGUOUS_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, 'i');
    if (regex.test(goal)) {
      errors.push({
        type: 'ambiguity',
        details: `Goal contains ambiguous word '${word}' that could mean different things`
      });
    }
  }

  // Must contain measurable outcome
  const hasMeasurableOutcome = MEASURABLE_OUTCOMES.some(outcome => {
    const regex = new RegExp(`\\b${outcome}\\b`, 'i');
    return regex.test(goal);
  });
  if (!hasMeasurableOutcome) {
    errors.push({
      type: 'intent',
      details: 'Goal must contain at least one measurable outcome keyword (capacity, count, rate, limit, threshold, size, bytes, memory, allow, deny, enabled, disabled, active, inactive, seconds, milliseconds, duration, interval)'
    });
  }

  // Check for multiple sentences (simple heuristic)
  const sentenceCount = (goal.match(/\./g) || []).length;
  if (sentenceCount > 1) {
    errors.push({
      type: 'intent',
      details: 'Goal must be a single sentence, found multiple periods'
    });
  }

  return errors;
}

/**
 * Validates scope according to strict rules.
 */
function validateScope(scope: { files: string[]; functions: string[]; exclusions?: string[] }): ValidationError[] {
  const errors: ValidationError[] = [];

  // Files array validation
  if (scope.files.length === 0) {
    errors.push({
      type: 'scope',
      details: 'Scope files array must contain at least 1 entry'
    });
  } else if (scope.files.length > 10) {
    errors.push({
      type: 'scope',
      details: `Scope files array must contain at most 10 entries, got ${scope.files.length}`
    });
  }

  // Functions array validation
  if (scope.functions.length === 0) {
    errors.push({
      type: 'scope',
      details: 'Scope functions array must contain at least 1 entry'
    });
  } else if (scope.functions.length > 20) {
    errors.push({
      type: 'scope',
      details: `Scope functions array must contain at most 20 entries, got ${scope.functions.length}`
    });
  }

  // Validate each file path
  for (const file of scope.files) {
    // Must start with target-service/patched/
    if (!file.startsWith('target-service/patched/')) {
      errors.push({
        type: 'scope',
        details: `File path '${file}' must start with 'target-service/patched/'`
      });
    }

    // Must not be baseline
    if (file.startsWith('target-service/baseline/')) {
      errors.push({
        type: 'scope',
        details: `File path '${file}' is in baseline directory - baseline files are immutable`
      });
    }

    // No wildcards
    if (file.includes('*') || file.includes('?') || file.includes('**')) {
      errors.push({
        type: 'scope',
        details: `File path '${file}' contains wildcards - not allowed`
      });
    }

    // File must exist
    if (!existsSync(file)) {
      errors.push({
        type: 'scope',
        details: `File '${file}' does not exist`
      });
    }
  }

  // Validate function names are valid identifiers
  const identifierRegex = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  for (const func of scope.functions) {
    if (!identifierRegex.test(func)) {
      errors.push({
        type: 'scope',
        details: `Function name '${func}' is not a valid TypeScript identifier`
      });
    }
  }

  // Validate exclusions are subset of scope
  if (scope.exclusions) {
    if (scope.exclusions.length > 5) {
      errors.push({
        type: 'scope',
        details: `Exclusions array must contain at most 5 entries, got ${scope.exclusions.length}`
      });
    }

    for (const exclusion of scope.exclusions) {
      const inFiles = scope.files.includes(exclusion);
      const inFunctions = scope.functions.includes(exclusion);
      if (!inFiles && !inFunctions) {
        errors.push({
          type: 'scope',
          details: `Exclusion '${exclusion}' is not in scope files or functions`
        });
      }
    }
  }

  // Validate functions exist in declared files
  // Use simple regex matching for function declarations
  for (const file of scope.files) {
    if (!existsSync(file)) {
      continue; // Already reported above
    }

    try {
      const content = readFileSync(file, 'utf-8');
      
      // Extract function names using regex (simple approach)
      const functionNames = new Set<string>();
      
      // Match function declarations: function name(...) or function name(...) {
      const funcDeclRegex = /function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
      let match;
      while ((match = funcDeclRegex.exec(content)) !== null) {
        functionNames.add(match[1]);
      }
      
      // Match method definitions: name(...) { or name: function(...) {
      const methodRegex = /(?:^|\s)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[:=]\s*function\s*\(/gm;
      while ((match = methodRegex.exec(content)) !== null) {
        functionNames.add(match[1]);
      }
      
      // Match class methods: name(...) {
      const classMethodRegex = /(?:public|private|protected)?\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*[:{]/g;
      while ((match = classMethodRegex.exec(content)) !== null) {
        functionNames.add(match[1]);
      }

      // Check each function in scope exists
      for (const func of scope.functions) {
        if (!functionNames.has(func)) {
          errors.push({
            type: 'scope',
            details: `Function '${func}' not found in file '${file}'`
          });
        }
      }
    } catch (error) {
      // If reading fails, we can't validate functions
      // This is acceptable - the file might not be readable
    }
  }

  return errors;
}

/**
 * Validates invariants according to strict rules.
 */
function validateInvariants(invariants: Array<{ name: string; metric_path: string; operator: string; threshold: number }>, testInputs: Array<{ key: string }>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (invariants.length === 0) {
    errors.push({
      type: 'invariant',
      details: 'Must have at least 1 invariant'
    });
    return errors;
  }

  if (invariants.length > 10) {
    errors.push({
      type: 'invariant',
      details: `Must have at most 10 invariants, got ${invariants.length}`
    });
  }

  // Get all keys from test inputs
  const testKeys = new Set(testInputs.map(input => input.key));

  for (const invariant of invariants) {
    // Validate name
    const nameRegex = /^[a-zA-Z0-9_]+$/;
    if (!nameRegex.test(invariant.name)) {
      errors.push({
        type: 'invariant',
        details: `Invariant name '${invariant.name}' must be alphanumeric + underscore only`
      });
    }

    // Validate metric_path
    const metricPath = invariant.metric_path;
    if (metricPath.startsWith('token_count.')) {
      // token_count.<key> format
      const key = metricPath.substring('token_count.'.length);
      if (!testKeys.has(key)) {
        errors.push({
          type: 'invariant',
          details: `Invariant metric_path '${metricPath}' references key '${key}' not found in test inputs`
        });
      }
    } else {
      // Must be in available metrics
      const validMetrics = ['allow_count', 'deny_count', 'key_count', 'memory_bytes'];
      if (!validMetrics.includes(metricPath)) {
        errors.push({
          type: 'invariant',
          details: `Metric path '${metricPath}' not in available metrics. Available: allow_count, deny_count, token_count.<key>, key_count, memory_bytes`
        });
      }
    }

    // Validate operator
    const validOperators: MetricOperator[] = ['lt', 'le', 'eq', 'ge', 'gt', 'ne'];
    if (!validOperators.includes(invariant.operator as MetricOperator)) {
      errors.push({
        type: 'invariant',
        details: `Operator '${invariant.operator}' not valid. Must be one of: lt, le, eq, ge, gt, ne`
      });
    }

    // Validate threshold is a number
    if (typeof invariant.threshold !== 'number' || isNaN(invariant.threshold)) {
      errors.push({
        type: 'invariant',
        details: `Threshold must be a number, got ${typeof invariant.threshold}`
      });
    }
  }

  return errors;
}

/**
 * Validates risk tolerance.
 */
function validateRiskTolerance(riskTolerance: string): ValidationError[] {
  const errors: ValidationError[] = [];

  const validTolerances = ['strict', 'moderate', 'permissive'];
  if (!validTolerances.includes(riskTolerance)) {
    errors.push({
      type: 'intent',
      details: `Risk tolerance must be one of: strict, moderate, permissive. Got: '${riskTolerance}'`
    });
  }

  return errors;
}

/**
 * Validates test inputs.
 */
function validateTestInputs(testInputs: Array<{ action: string; key: string; timestamp_ms?: number }>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (testInputs.length === 0) {
    errors.push({
      type: 'intent',
      details: 'Test inputs array must contain at least 1 entry'
    });
    return errors;
  }

  if (testInputs.length > 1000) {
    errors.push({
      type: 'intent',
      details: `Test inputs array must contain at most 1000 entries, got ${testInputs.length}`
    });
  }

  const validActions = ['allow', 'getRemaining'];
  for (let i = 0; i < testInputs.length; i++) {
    const input = testInputs[i];

    if (!validActions.includes(input.action)) {
      errors.push({
        type: 'intent',
        details: `Test input ${i}: action must be 'allow' or 'getRemaining', got '${input.action}'`
      });
    }

    if (!input.key || typeof input.key !== 'string' || input.key.length === 0) {
      errors.push({
        type: 'intent',
        details: `Test input ${i}: key must be a non-empty string`
      });
    }

    if (input.timestamp_ms !== undefined) {
      if (typeof input.timestamp_ms !== 'number' || input.timestamp_ms < 0 || isNaN(input.timestamp_ms)) {
        errors.push({
          type: 'intent',
          details: `Test input ${i}: timestamp_ms must be a non-negative number`
        });
      }
    }
  }

  return errors;
}

