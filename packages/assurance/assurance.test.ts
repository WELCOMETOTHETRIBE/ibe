import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalIdentityProvider } from '../identity/index.js';
import { FixedClock, digestOf } from '../shared/index.js';
import {
  decide,
  buildAssuranceCase,
  issueCertificate,
  verifyCertificate,
  type AssuranceInput,
} from './index.js';

function passingInput(): AssuranceInput {
  return {
    intentId: 'INT-1',
    intentHash: digestOf({ i: 1 }),
    modelVersion: 'v1',
    modelDeltaHash: digestOf({ d: 1 }),
    sourceCommit: 'abc',
    policyBundleHash: digestOf({ p: 1 }),
    policyBundleVersion: '1.0.0',
    artifactDigest: digestOf({ a: 1 }),
    causalTraceRoot: digestOf({ c: 1 }),
    builderIdentity: 'builder',
    verifierIdentities: ['verifier'],
    signerIdentity: 'signer',
    requestedAction: 'test.execute',
    environment: 'staging',
    authority: { allowed: true, reasons: [] },
    modelTraceability: { valid: true, reasons: [] },
    scope: { violations: [] },
    informationFlow: { violations: [] },
    causal: { conformant: true, reasons: [], requiredPassed: 3, forbiddenDetected: 0 },
    verification: {
      independentPassed: 1,
      minimumIndependent: 1,
      failedCaseIds: [],
      passedCaseIds: ['VER-1'],
      reasons: [],
    },
    evidence: { present: ['policy-decision'], missing: [], stale: [] },
    provenance: { reasons: [] },
    recovery: { required: true, tested: true },
    execution: { conclusive: true, isolated: true, outcome: 'success' },
    assumptions: { unresolved: [] },
  };
}

function signerIdp() {
  const idp = new LocalIdentityProvider();
  idp.register('signer', 'service', ['signer']);
  return { idp, signer: idp.signer('signer') };
}

test('kernel ACCEPTS when all gates pass and the certificate verifies', () => {
  const input = passingInput();
  const decision = decide(input);
  assert.equal(decision.decision, 'accepted');
  const { idp, signer } = signerIdp();
  const ac = buildAssuranceCase({
    decision: 'accepted',
    gates: decision.gates,
    evidenceRefs: [],
    assumptions: [],
    residualRisk: [],
    staleEvidence: [],
    freshnessNote: 'fresh',
  });
  const cert = issueCertificate(input, decision, ac, signer, new FixedClock());
  assert.equal(cert.decision, 'accepted');
  assert.equal(verifyCertificate(cert, idp).length, 0);
});

test('kernel REFUSES when any single gate fails', () => {
  const input = passingInput();
  input.scope.violations = [{ code: 'OUT_OF_SCOPE', message: 'touched forbidden file' }];
  const decision = decide(input);
  assert.equal(decision.decision, 'refused');
  assert.ok(decision.failedGates.includes('within-scope'));
});

test('kernel REFUSES when execution is inconclusive even if other gates pass', () => {
  const input = passingInput();
  input.execution = { conclusive: false, isolated: false, outcome: 'timeout' };
  assert.equal(decide(input).decision, 'refused');
});

test('a tampered accepted certificate fails verification', () => {
  const input = passingInput();
  const decision = decide(input);
  const { idp, signer } = signerIdp();
  const ac = buildAssuranceCase({
    decision: 'accepted',
    gates: decision.gates,
    evidenceRefs: [],
    assumptions: [],
    residualRisk: [],
    staleEvidence: [],
    freshnessNote: 'fresh',
  });
  const cert = issueCertificate(input, decision, ac, signer, new FixedClock());
  const tampered = { ...cert, source_commit: 'evil' };
  assert.ok(verifyCertificate(tampered, idp).some((r) => r.code === 'SIGNATURE_INVALID'));
});
