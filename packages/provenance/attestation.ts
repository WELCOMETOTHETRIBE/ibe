/**
 * Supply-chain provenance (§17), structured in the spirit of in-toto / SLSA and
 * signed with an identity-bound Ed25519 key (Sigstore-style keyless signing is a
 * planned production upgrade). We DO NOT claim conformance to a specific SLSA
 * level — the format is compatible in structure, not certified.
 *
 * The provenance predicate binds the full chain: intent, model version + delta,
 * source repo + commit, changed files, lockfile hash, build image digest,
 * builder + verifier identities, policy bundle hash, artifact digest, causal
 * trace root, and test-result digests.
 */

import {
  canonicalStringify,
  digestEquals,
  digestOf,
  type Digest,
  type Reason,
  reason,
} from '../shared/index.js';
import type { Signer, LocalIdentityProvider } from '../identity/index.js';

export interface ProvenancePredicate {
  intent_id: string;
  intent_hash: Digest;
  model_version: string;
  model_delta_hash: Digest;
  source_repository: string;
  source_commit: string;
  changed_files: string[];
  dependency_lockfile_hash: Digest;
  build_environment_image_digest: string;
  builder_identity: string;
  verifier_identities: string[];
  policy_bundle_hash: Digest;
  artifact_digest: Digest;
  causal_trace_root: Digest;
  test_result_digests: Digest[];
  timestamp: string;
}

/** in-toto-style statement + detached signatures. */
export interface Attestation {
  _type: 'https://in-toto.io/Statement/v1';
  subject: Array<{ name: string; digest: { sha256: string } }>;
  predicateType: 'https://ibe.dev/provenance/v0.2';
  predicate: ProvenancePredicate;
  signatures: Array<{ keyid: string; actor_id: string; sig: string }>;
}

function subjectFrom(predicate: ProvenancePredicate): Attestation['subject'] {
  const [, hex = ''] = predicate.artifact_digest.split(':');
  return [{ name: `artifact:${predicate.intent_id}`, digest: { sha256: hex } }];
}

export function createAttestation(predicate: ProvenancePredicate, signer: Signer): Attestation {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1' as const,
    subject: subjectFrom(predicate),
    predicateType: 'https://ibe.dev/provenance/v0.2' as const,
    predicate,
  };
  const sig = signer.sign(canonicalStringify(statement));
  return { ...statement, signatures: [{ keyid: signer.keyId, actor_id: signer.actorId, sig }] };
}

/** Verify the attestation signature(s). */
export function verifyAttestation(att: Attestation, idp: LocalIdentityProvider): Reason[] {
  const reasons: Reason[] = [];
  const { signatures, ...statement } = att;
  if (signatures.length === 0) {
    return [reason('PROVENANCE_MISMATCH', 'attestation has no signatures')];
  }
  const payload = canonicalStringify(statement);
  for (const s of signatures) {
    if (!idp.verify(s.actor_id, payload, s.sig)) {
      reasons.push(
        reason('SIGNATURE_INVALID', `attestation signature by ${s.actor_id} failed verification`),
      );
    }
  }
  return reasons;
}

/**
 * Promotion-time provenance gate (§17). Refuse when the built artifact/source/
 * policy/signer do not match what was verified.
 */
export interface PromotionCheck {
  expectedArtifactDigest: Digest;
  expectedSourceCommit: string;
  expectedPolicyBundleHash: Digest;
  authorizedSigners: string[];
}

export function checkProvenanceForPromotion(
  att: Attestation,
  check: PromotionCheck,
  idp: LocalIdentityProvider,
): Reason[] {
  const reasons = verifyAttestation(att, idp);
  const p = att.predicate;
  if (!digestEquals(p.artifact_digest, check.expectedArtifactDigest)) {
    reasons.push(
      reason('PROVENANCE_MISMATCH', 'artifact digest differs from the verified artifact'),
    );
  }
  if (p.source_commit !== check.expectedSourceCommit) {
    reasons.push(reason('PROVENANCE_MISMATCH', 'source commit differs from the verified commit'));
  }
  if (!digestEquals(p.policy_bundle_hash, check.expectedPolicyBundleHash)) {
    reasons.push(reason('PROVENANCE_MISMATCH', 'policy bundle version is unknown / changed'));
  }
  for (const s of att.signatures) {
    if (!check.authorizedSigners.includes(s.actor_id)) {
      reasons.push(reason('SIGNATURE_INVALID', `signer ${s.actor_id} is not authorized`));
    }
  }
  return reasons;
}

/** Hash of a dependency lockfile's content (supply-chain pinning evidence). */
export function lockfileHash(content: string): Digest {
  return digestOf(content);
}
