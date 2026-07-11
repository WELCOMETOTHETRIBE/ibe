/**
 * Evidence objects with freshness and automatic invalidation (§20).
 *
 * Every piece of evidence records the exact context it was collected under
 * (model version, source commit, artifact digest, policy version, verifier
 * version, trust-boundary + identity-policy versions) and a freshness window.
 * The kernel refuses to let stale evidence support a current certificate: if any
 * bound context value changed, or the window elapsed, the evidence is invalid.
 */

import {
  Clock,
  canonicalStringify,
  digestOf,
  systemClock,
  type Digest,
  type Reason,
} from '../shared/index.js';
import { reason } from '../shared/index.js';
import type { Signer, LocalIdentityProvider } from '../identity/index.js';

export type EvidenceType =
  | 'source-diff'
  | 'policy-decision'
  | 'test-results'
  | 'causal-trace'
  | 'artifact-digest'
  | 'verifier-attestation'
  | 'provenance'
  | 'model-delta'
  | 'oscal';

/** The context an evidence object is bound to. A change to any field invalidates it. */
export interface EvidenceContext {
  model_version: string;
  source_commit: string;
  artifact_digest: Digest | '';
  policy_version: string;
  verifier_version: string;
  trust_boundary_version: string;
  identity_policy_version: string;
}

export interface Evidence {
  evidence_id: string;
  type: EvidenceType;
  collected_at: string;
  collected_by: string;
  context: EvidenceContext;
  /** The actual evidence content digest (content stored elsewhere / inline hash). */
  content_hash: Digest;
  freshness_window_seconds: number;
  invalidating_conditions: string[];
  integrity_hash: Digest;
  signer_key_id: string;
  signature: string;
}

export interface CreateEvidenceInput {
  evidenceId: string;
  type: EvidenceType;
  collectedBy: string;
  context: EvidenceContext;
  content: unknown;
  freshnessWindowSeconds?: number;
}

const DEFAULT_INVALIDATION = [
  'model-element-changed',
  'source-commit-changed',
  'artifact-digest-changed',
  'policy-bundle-changed',
  'verifier-version-changed',
  'trust-boundary-changed',
  'identity-policy-changed',
  'freshness-window-elapsed',
];

export function createEvidence(
  input: CreateEvidenceInput,
  signer: Signer,
  clock: Clock = systemClock,
): Evidence {
  const contentHash = digestOf(input.content);
  const core = {
    evidence_id: input.evidenceId,
    type: input.type,
    collected_at: clock.nowIso(),
    collected_by: input.collectedBy,
    context: input.context,
    content_hash: contentHash,
    freshness_window_seconds: input.freshnessWindowSeconds ?? 86_400,
    invalidating_conditions: DEFAULT_INVALIDATION,
  };
  const integrity = digestOf(core);
  const signature = signer.sign(canonicalStringify({ ...core, integrity_hash: integrity }));
  return { ...core, integrity_hash: integrity, signer_key_id: signer.keyId, signature };
}

/** Verify integrity hash and signature of an evidence object. */
export function verifyEvidence(
  evidence: Evidence,
  collectorActorId: string,
  idp: LocalIdentityProvider,
): Reason[] {
  const reasons: Reason[] = [];
  const { integrity_hash, signer_key_id, signature, ...core } = evidence;
  if (digestOf(core) !== integrity_hash) {
    reasons.push(
      reason(
        'EVIDENCE_STALE',
        `evidence ${evidence.evidence_id} integrity hash mismatch (tampered)`,
      ),
    );
  }
  if (!idp.verify(collectorActorId, canonicalStringify({ ...core, integrity_hash }), signature)) {
    reasons.push(reason('SIGNATURE_INVALID', `evidence ${evidence.evidence_id} signature invalid`));
  }
  void signer_key_id;
  return reasons;
}

/**
 * Determine whether evidence is stale relative to the *current* context/time.
 * Returns the list of invalidating reasons (empty = still fresh).
 */
export function evidenceStaleReasons(
  evidence: Evidence,
  current: EvidenceContext,
  clock: Clock = systemClock,
): Reason[] {
  const out: Reason[] = [];
  const c = evidence.context;
  if (c.model_version !== current.model_version)
    out.push(
      reason('EVIDENCE_STALE', `${evidence.evidence_id}: model version changed`, {
        was: c.model_version,
        now: current.model_version,
      }),
    );
  if (c.source_commit !== current.source_commit)
    out.push(reason('EVIDENCE_STALE', `${evidence.evidence_id}: source commit changed`));
  if (current.artifact_digest && c.artifact_digest !== current.artifact_digest)
    out.push(reason('EVIDENCE_STALE', `${evidence.evidence_id}: artifact digest changed`));
  if (c.policy_version !== current.policy_version)
    out.push(reason('EVIDENCE_STALE', `${evidence.evidence_id}: policy bundle changed`));
  if (c.verifier_version !== current.verifier_version)
    out.push(reason('EVIDENCE_STALE', `${evidence.evidence_id}: verifier version changed`));
  if (c.trust_boundary_version !== current.trust_boundary_version)
    out.push(reason('EVIDENCE_STALE', `${evidence.evidence_id}: trust boundary changed`));
  if (c.identity_policy_version !== current.identity_policy_version)
    out.push(reason('EVIDENCE_STALE', `${evidence.evidence_id}: identity policy changed`));
  const ageSec = (clock.now() - Date.parse(evidence.collected_at)) / 1000;
  if (ageSec > evidence.freshness_window_seconds)
    out.push(
      reason('EVIDENCE_STALE', `${evidence.evidence_id}: freshness window elapsed`, { ageSec }),
    );
  return out;
}
