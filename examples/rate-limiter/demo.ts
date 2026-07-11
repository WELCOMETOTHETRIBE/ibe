/**
 * Vertical slice 1 — rate limiter (§24.1).
 *
 * Demonstrates the full chain on a valid intent whose scope authorizes the
 * `allow` function, executes the patched limiter in the runner, and lets
 * independent property-based verification observe that the "always allow" defect
 * violates the rate-limit invariant. Expected outcome: REFUSED, with a signed
 * refusal certificate and full evidence package.
 */

import { fileURLToPath } from 'node:url';
import { FixedClock } from '../../packages/shared/index.js';
import { validateIntent } from '../../packages/intent/index.js';
import { validateModel } from '../../packages/model/index.js';
import {
  selectRunner,
  withWorkspace,
  type ExecutionResult,
} from '../../packages/execution/index.js';
import { runPipeline, type PipelineResult } from '../../packages/orchestrator/index.js';
import { bootstrapIdentities } from '../common/identities.js';
import { rateLimiterVerifiers } from './verifiers.js';
import intentRaw from './intent.json' with { type: 'json' };
import modelRaw from './model.json' with { type: 'json' };

const HARNESS = fileURLToPath(new URL('./harness.js', import.meta.url));

async function runExecution(): Promise<ExecutionResult> {
  // Prefer the labeled local runner for deterministic CI (Docker used when present).
  const runner = selectRunner(process.env.IBE_USE_DOCKER === '1');
  return withWorkspace((dir) =>
    runner.run({
      workspaceDir: dir,
      command: process.execPath,
      args: [HARNESS],
      timeoutMs: 20000,
      network: false,
      artifacts: ['metrics.json'],
    }),
  );
}

export async function runRateLimiterDemo(): Promise<PipelineResult> {
  const clock = new FixedClock('2026-06-01T00:00:00.000Z');
  const identities = bootstrapIdentities();

  const intent = validateIntent(intentRaw);
  if (!intent.ok) throw new Error(`invalid demo intent: ${JSON.stringify(intent.error)}`);
  const model = validateModel(modelRaw);
  if (!model.ok) throw new Error(`invalid demo model: ${JSON.stringify(model.error)}`);

  return runPipeline({
    intent: intent.value,
    identities,
    clock,
    request: { action: 'test.execute', resource: 'examples/rate-limiter', environment: 'staging' },
    approvals: ['human-governor-01'],
    model: { proposed: model.value },
    changedElementIds: ['CMP-RATELIMIT'],
    sourceCommit: 'demo-ratelimiter-0001',
    changedFiles: [
      {
        path: 'examples/rate-limiter/target/patched.ts',
        status: 'modified',
        addedLines: 1,
        removedLines: 3,
      },
    ],
    symbolChanges: {
      'examples/rate-limiter/target/patched.ts': [
        { name: 'allow', kind: 'method', change: 'modified' },
      ],
    },
    runExecution,
    subjectVerifiers: rateLimiterVerifiers(),
    requiredPatterns: ['IntentAuthorized->CapabilityIssued->BuildStarted->BuildCompleted'],
    recoveryTested: true,
  });
}
