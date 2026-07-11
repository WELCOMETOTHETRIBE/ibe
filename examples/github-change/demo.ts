/**
 * Vertical slice 2 — GitHub-style source change (§24.2).
 *
 * The intent authorizes exactly one file (src/auth.ts) and one function (login).
 * The proposed change ALSO modifies an unauthorized file (src/billing.ts). Real
 * unified-diff parsing + ts-morph AST symbol analysis detect the out-of-scope
 * edit; the scope gate fails and the kernel REFUSES capability/promotion, while
 * still emitting a full, signed evidence package. Expected outcome: REFUSED.
 */

import { FixedClock } from '../../packages/shared/index.js';
import { validateIntent } from '../../packages/intent/index.js';
import { validateModel } from '../../packages/model/index.js';
import { parseUnifiedDiff, changedSymbols } from '../../packages/adapters/index.js';
import {
  selectRunner,
  withWorkspace,
  type ExecutionResult,
} from '../../packages/execution/index.js';
import { runPipeline, type PipelineResult } from '../../packages/orchestrator/index.js';
import { bootstrapIdentities } from '../common/identities.js';
import intentRaw from './intent.json' with { type: 'json' };
import modelRaw from './model.json' with { type: 'json' };

// A realistic unified diff: an in-scope edit to auth.ts AND an out-of-scope edit
// to billing.ts (the kind of scope creep IBE must catch).
const DIFF = `diff --git a/src/auth.ts b/src/auth.ts
index 1111111..2222222 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,4 +1,4 @@
 export function login(user: string, pass: string): boolean {
-  return check(user, pass);
+  return check(user, pass) && rateOk(user);
 }
diff --git a/src/billing.ts b/src/billing.ts
index 3333333..4444444 100644
--- a/src/billing.ts
+++ b/src/billing.ts
@@ -1,3 +1,3 @@
 export function chargeCard(id: string, amount: number): void {
-  gateway.charge(id, amount);
+  gateway.charge(id, amount * 100);
 }
`;

const AUTH_BEFORE = `export function login(user: string, pass: string): boolean {\n  return check(user, pass);\n}\n`;
const AUTH_AFTER = `export function login(user: string, pass: string): boolean {\n  return check(user, pass) && rateOk(user);\n}\n`;

async function runExecution(): Promise<ExecutionResult> {
  const runner = selectRunner(false);
  return withWorkspace((dir) =>
    runner.run({
      workspaceDir: dir,
      command: process.execPath,
      args: ['-e', 'process.stdout.write("build ok")'],
      timeoutMs: 10000,
      network: false,
    }),
  );
}

export async function runGithubChangeDemo(): Promise<PipelineResult> {
  const clock = new FixedClock('2026-06-01T00:00:00.000Z');
  const identities = bootstrapIdentities();

  const intent = validateIntent(intentRaw);
  if (!intent.ok) throw new Error(`invalid intent: ${JSON.stringify(intent.error)}`);
  const model = validateModel(modelRaw);
  if (!model.ok) throw new Error(`invalid model: ${JSON.stringify(model.error)}`);

  const changedFiles = parseUnifiedDiff(DIFF);
  const authSymbols = changedSymbols(AUTH_BEFORE, AUTH_AFTER, 'src/auth.ts');

  return runPipeline({
    intent: intent.value,
    identities,
    clock,
    request: {
      action: 'repository.write_branch',
      resource: 'src/auth.ts',
      environment: 'development',
    },
    approvals: ['human-governor-01'],
    model: { proposed: model.value },
    changedElementIds: ['CMP-AUTH'],
    sourceCommit: 'demo-github-0002',
    changedFiles,
    symbolChanges: { 'src/auth.ts': authSymbols },
    runExecution,
    recoveryTested: true,
  });
}
