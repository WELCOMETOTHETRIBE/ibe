/**
 * The deterministic assurance kernel (§1, §2, Governing rule).
 *
 * This is the independent engineering authority. It consumes a fully-assembled
 * set of stage results and evaluates the governing rule:
 *
 *   Authorized AND Model-traceable AND Within-scope AND Policy-compliant
 *   AND Causally-valid AND Independently-verified AND Evidence-complete
 *   AND Recoverable  OR  REFUSE
 *
 * No LLM participates in this decision. Every gate is a pure function over
 * structured inputs; any failure fails closed. The kernel also refuses when the
 * final execution state is unknown (timeout/crash/isolation-unavailable), so a
 * certificate is never issued over an inconclusive run.
 */

import type { Digest, Reason } from '../shared/index.js';
import { reason } from '../shared/index.js';
import type { GateOutcome } from './case.js';

export interface AssuranceInput {
  // Identity / binding
  intentId: string;
  intentHash: Digest;
  modelVersion: string;
  modelDeltaHash: Digest;
  sourceCommit: string;
  policyBundleHash: Digest;
  policyBundleVersion: string;
  artifactDigest: Digest;
  causalTraceRoot: Digest;
  builderIdentity: string;
  verifierIdentities: string[];
  signerIdentity: string;
  requestedAction: string;
  environment: string;

  // Stage results
  authority: { allowed: boolean; reasons: Reason[] };
  modelTraceability: { valid: boolean; reasons: Reason[] };
  scope: { violations: Reason[] };
  informationFlow: { violations: Reason[] };
  causal: {
    conformant: boolean;
    reasons: Reason[];
    requiredPassed: number;
    forbiddenDetected: number;
  };
  verification: {
    independentPassed: number;
    minimumIndependent: number;
    failedCaseIds: string[];
    passedCaseIds: string[];
    reasons: Reason[];
  };
  evidence: { present: string[]; missing: string[]; stale: string[] };
  provenance: { reasons: Reason[] };
  recovery: { required: boolean; tested: boolean };
  execution: { conclusive: boolean; isolated: boolean; outcome: string };
  assumptions: { unresolved: Reason[] };
}

const CLAUSES: Record<string, string> = {
  authorized: 'Authorized (came from an authorized intent within its validity window)',
  'model-traceable': 'Model-traceable (change maps to model elements; model integrity holds)',
  'within-scope': 'Within scope (no change outside authorized files/functions/paths)',
  'policy-compliant': 'Policy-compliant (no information-flow or policy violations)',
  'causally-valid': 'Causally valid (event trace structurally sound; patterns satisfied)',
  'independently-verified': 'Independently verified (enough independent verifiers passed)',
  'evidence-complete': 'Evidence-complete (all required, fresh, signed evidence present)',
  recoverable: 'Recoverable (a tested path to a safe state exists when required)',
};

export function evaluateGates(input: AssuranceInput): GateOutcome[] {
  const gates: GateOutcome[] = [];

  // 1. Authorized
  gates.push({
    id: 'authorized',
    clause: CLAUSES['authorized']!,
    passed: input.authority.allowed,
    reasons: input.authority.allowed ? [] : input.authority.reasons,
  });

  // 2. Model-traceable
  gates.push({
    id: 'model-traceable',
    clause: CLAUSES['model-traceable']!,
    passed: input.modelTraceability.valid && input.assumptions.unresolved.length === 0,
    reasons: [
      ...(input.modelTraceability.valid ? [] : input.modelTraceability.reasons),
      ...input.assumptions.unresolved,
    ],
  });

  // 3. Within scope
  gates.push({
    id: 'within-scope',
    clause: CLAUSES['within-scope']!,
    passed: input.scope.violations.length === 0,
    reasons: input.scope.violations,
  });

  // 4. Policy-compliant (information flow)
  gates.push({
    id: 'policy-compliant',
    clause: CLAUSES['policy-compliant']!,
    passed: input.informationFlow.violations.length === 0,
    reasons: input.informationFlow.violations,
  });

  // 5. Causally valid (+ execution must be conclusive)
  const causalReasons = [...input.causal.reasons];
  if (!input.execution.conclusive) {
    causalReasons.push(
      reason(
        'EXECUTION_FAILED',
        `execution outcome "${input.execution.outcome}" is inconclusive; cannot accept`,
        {
          outcome: input.execution.outcome,
        },
      ),
    );
  }
  gates.push({
    id: 'causally-valid',
    clause: CLAUSES['causally-valid']!,
    passed: input.causal.conformant && input.execution.conclusive,
    reasons: causalReasons,
  });

  // 6. Independently verified
  const indepOk =
    input.verification.independentPassed >= input.verification.minimumIndependent &&
    input.verification.failedCaseIds.length === 0;
  gates.push({
    id: 'independently-verified',
    clause: CLAUSES['independently-verified']!,
    passed: indepOk,
    reasons: indepOk
      ? []
      : [
          ...input.verification.reasons,
          ...(input.verification.failedCaseIds.length
            ? [
                reason(
                  'VERIFICATION_FAILED',
                  `failed verification cases: ${input.verification.failedCaseIds.join(', ')}`,
                ),
              ]
            : []),
        ],
  });

  // 7. Evidence-complete (+ provenance)
  const evOk =
    input.evidence.missing.length === 0 &&
    input.evidence.stale.length === 0 &&
    input.provenance.reasons.length === 0;
  gates.push({
    id: 'evidence-complete',
    clause: CLAUSES['evidence-complete']!,
    passed: evOk,
    reasons: [
      ...(input.evidence.missing.length
        ? [reason('EVIDENCE_INCOMPLETE', `missing: ${input.evidence.missing.join(', ')}`)]
        : []),
      ...(input.evidence.stale.length
        ? [reason('EVIDENCE_STALE', `stale: ${input.evidence.stale.join(', ')}`)]
        : []),
      ...input.provenance.reasons,
    ],
  });

  // 8. Recoverable
  const recOk = !input.recovery.required || input.recovery.tested;
  gates.push({
    id: 'recoverable',
    clause: CLAUSES['recoverable']!,
    passed: recOk,
    reasons: recOk ? [] : [reason('RECOVERY_OBLIGATION_UNMET', 'recovery required but not tested')],
  });

  return gates;
}

export interface KernelDecision {
  decision: 'accepted' | 'refused';
  gates: GateOutcome[];
  failedGates: string[];
  reasons: Reason[];
}

/** The single authoritative decision function. Accept only if ALL gates pass. */
export function decide(input: AssuranceInput): KernelDecision {
  const gates = evaluateGates(input);
  const failed = gates.filter((g) => !g.passed);
  return {
    decision: failed.length === 0 ? 'accepted' : 'refused',
    gates,
    failedGates: failed.map((g) => g.id),
    reasons: failed.flatMap((g) => g.reasons),
  };
}
