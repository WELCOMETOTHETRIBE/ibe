/**
 * Signed Engineering Assurance Certificate (§23).
 *
 * Issued ONLY after the kernel's governing rule passes (acceptance) or to record
 * a refusal with its evidence. The certificate binds the full identity chain and
 * is Ed25519-signed. `verifyCertificate` re-checks the signature AND the internal
 * self-consistency invariants, so an accepted certificate that secretly carries
 * missing evidence or a detected forbidden pattern fails verification — the CI
 * gate `ibe assurance verify` depends on this.
 */

import {
  Clock,
  SequentialIdGenerator,
  canonicalStringify,
  systemClock,
  type Digest,
  type Reason,
  reason,
} from '../shared/index.js';
import type { Signer, LocalIdentityProvider } from '../identity/index.js';
import type { AssuranceCase } from './case.js';
import type { AssuranceInput, KernelDecision } from './kernel.js';

interface CommonCert {
  id: string;
  intent_id: string;
  intent_hash: Digest;
  model_version: string;
  model_delta_hash: Digest;
  source_commit: string;
  artifact_digest: Digest;
  builder_identity: string;
  verifier_identities: string[];
  policy_bundle_hash: Digest;
  causal_trace_root: Digest;
  issued_at: string;
  signer: string;
  signer_key_id: string;
}

export interface AcceptanceCertificate extends CommonCert {
  decision: 'accepted';
  required_patterns_passed: number;
  forbidden_patterns_detected: number;
  verification_cases_passed: string[];
  rollback_tested: boolean;
  execution_isolated: boolean;
  unresolved_assumptions: string[];
  stale_evidence: string[];
  assurance_case: AssuranceCase;
  signature: string;
}

export interface RefusalCertificate extends CommonCert {
  decision: 'refused';
  failed_gates: string[];
  violations: Reason[];
  missing_evidence: string[];
  prohibited_event_patterns: string[];
  unauthorized_scope: string[];
  residual_findings: Reason[];
  assurance_case: AssuranceCase;
  signature: string;
}

export type Certificate = AcceptanceCertificate | RefusalCertificate;

function common(input: AssuranceInput, id: string, signer: Signer, clock: Clock): CommonCert {
  return {
    id,
    intent_id: input.intentId,
    intent_hash: input.intentHash,
    model_version: input.modelVersion,
    model_delta_hash: input.modelDeltaHash,
    source_commit: input.sourceCommit,
    artifact_digest: input.artifactDigest,
    builder_identity: input.builderIdentity,
    verifier_identities: input.verifierIdentities,
    policy_bundle_hash: input.policyBundleHash,
    causal_trace_root: input.causalTraceRoot,
    issued_at: clock.nowIso(),
    signer: signer.actorId,
    signer_key_id: signer.keyId,
  };
}

export function issueCertificate(
  input: AssuranceInput,
  decision: KernelDecision,
  assuranceCase: AssuranceCase,
  signer: Signer,
  clock: Clock = systemClock,
  idGen?: SequentialIdGenerator,
): Certificate {
  const ids = idGen ?? new SequentialIdGenerator('CERT');
  const base = common(input, ids.next(), signer, clock);

  if (decision.decision === 'accepted') {
    const core: Omit<AcceptanceCertificate, 'signature'> = {
      ...base,
      decision: 'accepted',
      required_patterns_passed: input.causal.requiredPassed,
      forbidden_patterns_detected: input.causal.forbiddenDetected,
      verification_cases_passed: input.verification.passedCaseIds,
      rollback_tested: input.recovery.tested,
      execution_isolated: input.execution.isolated,
      unresolved_assumptions: input.assumptions.unresolved.map((r) => r.message),
      stale_evidence: input.evidence.stale,
      assurance_case: assuranceCase,
    };
    return { ...core, signature: signer.sign(canonicalStringify(core)) };
  }

  const core: Omit<RefusalCertificate, 'signature'> = {
    ...base,
    decision: 'refused',
    failed_gates: decision.failedGates,
    violations: decision.reasons,
    missing_evidence: input.evidence.missing,
    prohibited_event_patterns: decision.reasons
      .filter((r) => r.code === 'FORBIDDEN_EVENT_PATTERN')
      .map((r) => r.message),
    unauthorized_scope: input.scope.violations.map((r) => r.message),
    residual_findings: [...input.assumptions.unresolved, ...input.provenance.reasons],
    assurance_case: assuranceCase,
  };
  return { ...core, signature: signer.sign(canonicalStringify(core)) };
}

/** Verify signature + self-consistency invariants. Empty result = valid. */
export function verifyCertificate(cert: Certificate, idp: LocalIdentityProvider): Reason[] {
  const reasons: Reason[] = [];
  const { signature, ...core } = cert;
  if (!idp.verify(cert.signer, canonicalStringify(core), signature)) {
    reasons.push(
      reason('SIGNATURE_INVALID', `certificate ${cert.id} signature verification failed`),
    );
  }
  // Self-consistency: an acceptance certificate may not carry unmet obligations.
  // Defensive against tampered/malformed inputs (fields may be missing).
  if (cert.decision === 'accepted') {
    if ((cert.forbidden_patterns_detected ?? 0) > 0) {
      reasons.push(
        reason(
          'FORBIDDEN_EVENT_PATTERN',
          `accepted certificate reports ${cert.forbidden_patterns_detected} forbidden pattern(s)`,
        ),
      );
    }
    if ((cert.stale_evidence ?? []).length > 0) {
      reasons.push(reason('EVIDENCE_STALE', 'accepted certificate carries stale evidence'));
    }
    if ((cert.unresolved_assumptions ?? []).length > 0) {
      reasons.push(
        reason('ASSUMPTION_VIOLATION', 'accepted certificate carries unresolved assumptions'),
      );
    }
    if (cert.assurance_case?.confidence === 'refuted') {
      reasons.push(reason('UNKNOWN', 'accepted certificate has a refuted assurance case'));
    }
  }
  return reasons;
}
