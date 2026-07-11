import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock } from '../packages/shared/index.js';
import { validateIntent } from '../packages/intent/index.js';
import { validateModel } from '../packages/model/index.js';
import { LocalIdentityProvider } from '../packages/identity/index.js';
import { verifyCertificate } from '../packages/assurance/index.js';
import { runPipeline } from '../packages/orchestrator/index.js';
import type { Verifier, VerificationResult } from '../packages/verification/index.js';
import { runRateLimiterDemo } from './rate-limiter/demo.js';
import { runGithubChangeDemo } from './github-change/demo.js';
import { runTerraformDemo } from './terraform-azure/demo.js';
import { bootstrapIdentities } from './common/identities.js';
import rateIntent from './rate-limiter/intent.json' with { type: 'json' };
import rateModel from './rate-limiter/model.json' with { type: 'json' };

test('rate-limiter demo REFUSES the always-allow patch', async () => {
  const r = await runRateLimiterDemo();
  assert.equal(r.decision, 'refused');
  assert.ok(r.gates.find((g) => g.id === 'independently-verified' && !g.passed));
});

test('github-change demo REFUSES the out-of-scope file edit', async () => {
  const r = await runGithubChangeDemo();
  assert.equal(r.decision, 'refused');
  assert.ok(r.scopeReport.outOfScopeFiles.includes('src/billing.ts'));
});

test('terraform demo REFUSES the public admin endpoint', async () => {
  const r = await runTerraformDemo();
  assert.equal(r.decision, 'refused');
  assert.ok(
    r.reasons.some(
      (x) => x.code === 'TRUST_BOUNDARY_VIOLATION' || x.code === 'INFORMATION_FLOW_VIOLATION',
    ),
  );
});

test('every demo certificate re-verifies from its keyring', async () => {
  for (const run of [runRateLimiterDemo, runGithubChangeDemo, runTerraformDemo]) {
    const r = await run();
    const idp = new LocalIdentityProvider();
    for (const [id, pem] of Object.entries(r.keyring))
      idp.registerPublicKey(id, 'service', ['signer'], pem);
    assert.equal(verifyCertificate(r.certificate, idp).length, 0);
  }
});

// The three demos are refusals by design. This synthetic scenario exercises the
// ACCEPT path so we prove the kernel is not merely always-refusing.
class AlwaysPassVerifier implements Verifier {
  id = 'verifier.test.pass';
  caseId = 'VER-RATELIMIT-PROP';
  category = 'property' as const;
  independentOf(): boolean {
    return true;
  }
  run(): VerificationResult {
    return {
      caseId: this.caseId,
      verifierId: this.id,
      category: this.category,
      passed: true,
      independentOfBuilder: true,
      reasons: [],
    };
  }
}

test('pipeline ACCEPTS when scope, verification, evidence, and recovery all pass', async () => {
  const intent = validateIntent(rateIntent);
  const model = validateModel(rateModel);
  assert.ok(intent.ok && model.ok);

  const result = await runPipeline({
    intent: intent.value,
    identities: bootstrapIdentities(),
    clock: new FixedClock('2026-06-01T00:00:00.000Z'),
    request: { action: 'test.execute', resource: 'examples/rate-limiter', environment: 'staging' },
    approvals: ['human-governor-01'],
    model: { proposed: model.value },
    changedElementIds: ['CMP-RATELIMIT'],
    sourceCommit: 'accept-scenario',
    changedFiles: [
      {
        path: 'examples/rate-limiter/target/patched.ts',
        status: 'modified',
        addedLines: 1,
        removedLines: 1,
      },
    ],
    symbolChanges: {
      'examples/rate-limiter/target/patched.ts': [
        { name: 'allow', kind: 'method', change: 'modified' },
      ],
    },
    // A benign execution that completes successfully.
    runExecution: async () => ({
      runner: 'test',
      isolated: true,
      outcome: 'success',
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      artifactDigests: {},
      durationMs: 1,
    }),
    subjectVerifiers: [new AlwaysPassVerifier()],
    requiredPatterns: ['IntentAuthorized->CapabilityIssued->BuildStarted->BuildCompleted'],
    recoveryTested: true,
  });

  assert.equal(result.decision, 'accepted', JSON.stringify(result.reasons));
  const idp = new LocalIdentityProvider();
  for (const [id, pem] of Object.entries(result.keyring))
    idp.registerPublicKey(id, 'service', ['signer'], pem);
  assert.equal(verifyCertificate(result.certificate, idp).length, 0);
});
