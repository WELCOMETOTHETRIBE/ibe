#!/usr/bin/env node

/**
 * CLI entry point for Intent-Bound Execution.
 * Orchestrates validation, shadow execution, and refusal decision.
 * Output is JSON only - no human-readable messages.
 */

import { parseIntent } from './intent/parser.js';
import { validateIntent } from './intent/validator.js';
import { runShadowExecution } from './shadow/executor.js';
import { evaluateRefusal } from './refusal/engine.js';
import { existsSync } from 'fs';

const DEFAULT_CONFIG = {
  capacity: 10,
  refillRate: 5
};

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    const result = {
      accepted: false,
      reason: 'No intent file provided',
      violations: [{
        type: 'intent' as const,
        details: 'Usage: ibe <intent-file.json>'
      }]
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const intentPath = args[0];

  if (!existsSync(intentPath)) {
    const result = {
      accepted: false,
      reason: 'Intent file not found',
      violations: [{
        type: 'intent' as const,
        details: `File '${intentPath}' does not exist`
      }]
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  try {
    // Step 1: Load intent JSON
    const intent = parseIntent(intentPath);

    // Step 2: Validate intent schema and checkability
    const validationResult = validateIntent(intent);

    // Step 3: If validation fails, refuse immediately
    if (!validationResult.valid) {
      const result = {
        accepted: false,
        reason: 'Intent validation failed',
        violations: validationResult.errors.map(e => ({
          type: e.type,
          details: e.details
        }))
      };
      console.log(JSON.stringify(result, null, 2));
      process.exit(1);
    }

    // Step 4: Run shadow execution
    const { baseline, patched } = await runShadowExecution(
      intent.test_inputs,
      DEFAULT_CONFIG
    );

    // Step 5: Evaluate refusal
    const refusalResult = evaluateRefusal(
      intent,
      validationResult.errors,
      baseline.metrics,
      patched.metrics,
      baseline.success,
      patched.success
    );

    // Step 6: Output JSON result
    console.log(JSON.stringify(refusalResult, null, 2));

    process.exit(refusalResult.accepted ? 0 : 1);
  } catch (error) {
    const result = {
      accepted: false,
      reason: 'Execution error',
      violations: [{
        type: 'intent' as const,
        details: error instanceof Error ? error.message : String(error)
      }]
    };
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

main().catch(error => {
  const result = {
    accepted: false,
    reason: 'Unexpected error',
    violations: [{
      type: 'intent' as const,
      details: error instanceof Error ? error.message : String(error)
    }]
  };
  console.log(JSON.stringify(result, null, 2));
  process.exit(1);
});

