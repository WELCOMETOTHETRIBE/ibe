import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalIdentityProvider } from '../identity/index.js';
import { FixedClock, digestOf } from '../shared/index.js';
import {
  createEvidence,
  verifyEvidence,
  evidenceStaleReasons,
  createAttestation,
  verifyAttestation,
  checkProvenanceForPromotion,
  type EvidenceContext,
} from './index.js';

function signerIdp() {
  const idp = new LocalIdentityProvider();
  idp.register('signer', 'service', ['signer']);
  return { idp, signer: idp.signer('signer') };
}

const ctx: EvidenceContext = {
  model_version: 'v1',
  source_commit: 'abc',
  artifact_digest: digestOf({ a: 1 }),
  policy_version: '1.0.0',
  verifier_version: '1.0.0',
  trust_boundary_version: 'stable',
  identity_policy_version: '1.0.0',
};

test('evidence is signed and verifies', () => {
  const { idp, signer } = signerIdp();
  const ev = createEvidence(
    {
      evidenceId: 'EVD-1',
      type: 'policy-decision',
      collectedBy: 'signer',
      context: ctx,
      content: { x: 1 },
    },
    signer,
    new FixedClock('2026-06-01T00:00:00.000Z'),
  );
  assert.equal(verifyEvidence(ev, 'signer', idp).length, 0);
});

test('evidence goes stale when the model version changes', () => {
  const { signer } = signerIdp();
  const ev = createEvidence(
    {
      evidenceId: 'EVD-2',
      type: 'model-delta',
      collectedBy: 'signer',
      context: ctx,
      content: { x: 1 },
    },
    signer,
    new FixedClock('2026-06-01T00:00:00.000Z'),
  );
  const reasons = evidenceStaleReasons(
    ev,
    { ...ctx, model_version: 'v2' },
    new FixedClock('2026-06-01T00:00:00.000Z'),
  );
  assert.ok(reasons.some((r) => r.code === 'EVIDENCE_STALE'));
});

test('evidence goes stale after its freshness window elapses', () => {
  const { signer } = signerIdp();
  const clock = new FixedClock('2026-06-01T00:00:00.000Z');
  const ev = createEvidence(
    {
      evidenceId: 'EVD-3',
      type: 'test-results',
      collectedBy: 'signer',
      context: ctx,
      content: {},
      freshnessWindowSeconds: 10,
    },
    signer,
    clock,
  );
  clock.advance(11_000);
  assert.ok(evidenceStaleReasons(ev, ctx, clock).some((r) => r.code === 'EVIDENCE_STALE'));
});

test('attestation signs and verifies; tamper is caught', () => {
  const { idp, signer } = signerIdp();
  const att = createAttestation(
    {
      intent_id: 'INT-1',
      intent_hash: digestOf({ i: 1 }),
      model_version: 'v1',
      model_delta_hash: digestOf({ d: 1 }),
      source_repository: 'r',
      source_commit: 'abc',
      changed_files: ['a.ts'],
      dependency_lockfile_hash: digestOf('lock'),
      build_environment_image_digest: 'img',
      builder_identity: 'builder',
      verifier_identities: ['verifier'],
      policy_bundle_hash: digestOf({ p: 1 }),
      artifact_digest: digestOf({ a: 1 }),
      causal_trace_root: digestOf({ c: 1 }),
      test_result_digests: [digestOf({ t: 1 })],
      timestamp: '2026-06-01T00:00:00.000Z',
    },
    signer,
  );
  assert.equal(verifyAttestation(att, idp).length, 0);

  const tampered = { ...att, predicate: { ...att.predicate, source_commit: 'evil' } };
  assert.ok(verifyAttestation(tampered, idp).some((r) => r.code === 'SIGNATURE_INVALID'));
});

test('promotion provenance check refuses an unauthorized signer and mismatched artifact', () => {
  const { idp, signer } = signerIdp();
  const att = createAttestation(
    {
      intent_id: 'INT-1',
      intent_hash: digestOf({ i: 1 }),
      model_version: 'v1',
      model_delta_hash: digestOf({ d: 1 }),
      source_repository: 'r',
      source_commit: 'abc',
      changed_files: [],
      dependency_lockfile_hash: digestOf('lock'),
      build_environment_image_digest: 'img',
      builder_identity: 'builder',
      verifier_identities: ['verifier'],
      policy_bundle_hash: digestOf({ p: 1 }),
      artifact_digest: digestOf({ a: 1 }),
      causal_trace_root: digestOf({ c: 1 }),
      test_result_digests: [],
      timestamp: '2026-06-01T00:00:00.000Z',
    },
    signer,
  );
  const reasons = checkProvenanceForPromotion(
    att,
    {
      expectedArtifactDigest: digestOf({ a: 999 }),
      expectedSourceCommit: 'abc',
      expectedPolicyBundleHash: digestOf({ p: 1 }),
      authorizedSigners: ['someone-else'],
    },
    idp,
  );
  assert.ok(reasons.some((r) => r.code === 'PROVENANCE_MISMATCH'));
  assert.ok(reasons.some((r) => r.code === 'SIGNATURE_INVALID'));
});
