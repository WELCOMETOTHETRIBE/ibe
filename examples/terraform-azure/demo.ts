/**
 * Vertical slice 3 — Terraform / Azure infrastructure change (§24.3).
 *
 * The intent authorizes a staging-only network change that must keep the CUI
 * vault private. The Terraform plan (fixture, no live Azure) proposes a public
 * administrative endpoint. The Terraform adapter + classification-aware
 * information-flow analysis over the CUI-Vault model detect the trust-boundary /
 * information-flow violation; the kernel REFUSES and OSCAL + assurance outputs
 * are generated. Expected outcome: REFUSED.
 */

import { FixedClock } from '../../packages/shared/index.js';
import { validateIntent } from '../../packages/intent/index.js';
import { validateModel, checkInformationFlows } from '../../packages/model/index.js';
import { analyzeTerraformPlan } from '../../packages/adapters/index.js';
import {
  selectRunner,
  withWorkspace,
  type ExecutionResult,
} from '../../packages/execution/index.js';
import { runPipeline, type PipelineResult } from '../../packages/orchestrator/index.js';
import { bootstrapIdentities } from '../common/identities.js';
import intentRaw from './intent.json' with { type: 'json' };
import modelRaw from './model.json' with { type: 'json' };
import planRaw from './plan.json' with { type: 'json' };

async function runExecution(): Promise<ExecutionResult> {
  const runner = selectRunner(false);
  return withWorkspace((dir) =>
    runner.run({
      workspaceDir: dir,
      command: process.execPath,
      args: ['-e', 'process.stdout.write("terraform plan captured")'],
      timeoutMs: 10000,
      network: false,
    }),
  );
}

export async function runTerraformDemo(): Promise<PipelineResult> {
  const clock = new FixedClock('2026-06-01T00:00:00.000Z');
  const identities = bootstrapIdentities();

  const intent = validateIntent(intentRaw);
  if (!intent.ok) throw new Error(`invalid intent: ${JSON.stringify(intent.error)}`);
  const model = validateModel(modelRaw);
  if (!model.ok) throw new Error(`invalid model: ${JSON.stringify(model.error)}`);

  const tf = analyzeTerraformPlan(planRaw);
  const flowFindings = checkInformationFlows(model.value).map((f) => f.reason);
  const infoViolations = [...tf.findings, ...flowFindings];

  return runPipeline({
    intent: intent.value,
    identities,
    clock,
    request: { action: 'terraform.plan', resource: 'staging-network', environment: 'staging' },
    approvals: ['human-governor-01'],
    model: { proposed: model.value },
    changedElementIds: ['IF-VAULT-PUBLIC', 'CMP-CUI-VAULT'],
    trustBoundaryChanged: tf.trustBoundaryChanged,
    informationFlowViolations: infoViolations,
    sourceCommit: 'demo-terraform-0003',
    changedFiles: [
      { path: 'infra/network.tf', status: 'modified', addedLines: 12, removedLines: 0 },
    ],
    cost: { estimatedUsd: 5 },
    blastRadius: 'staging',
    runExecution,
    recoveryTested: true,
  });
}
