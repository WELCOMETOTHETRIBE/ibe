/**
 * Structured assurance cases (§18), inspired by SACM/GSN. Every accepted OR
 * refused execution produces an evidence-backed assurance case: a top claim, the
 * argument decomposed over the governing-rule gates, the supporting evidence,
 * assumptions, counter-evidence (why gates failed), residual risk, a confidence
 * status, and the conditions that would invalidate the case.
 */

import type { Reason } from '../shared/index.js';

export type Confidence = 'high' | 'moderate' | 'low' | 'refuted';

export interface AssuranceCase {
  claim: string;
  argument: string[];
  evidence: string[];
  assumptions: string[];
  counter_evidence: Reason[];
  residual_risk: string[];
  confidence: Confidence;
  invalidating_conditions: string[];
  evidence_freshness: string;
}

export interface GateOutcome {
  id: string;
  clause: string;
  passed: boolean;
  reasons: Reason[];
}

export interface CaseInputs {
  decision: 'accepted' | 'refused';
  gates: GateOutcome[];
  evidenceRefs: string[];
  assumptions: string[];
  residualRisk: string[];
  staleEvidence: string[];
  freshnessNote: string;
}

export function buildAssuranceCase(inputs: CaseInputs): AssuranceCase {
  const argument = inputs.gates.map(
    (g) =>
      `${g.passed ? 'PASS' : 'FAIL'} — ${g.clause}: ${g.passed ? 'satisfied' : 'NOT satisfied'}`,
  );
  const counter = inputs.gates.filter((g) => !g.passed).flatMap((g) => g.reasons);

  let confidence: Confidence;
  if (inputs.decision === 'refused') confidence = 'refuted';
  else if (inputs.staleEvidence.length > 0) confidence = 'low';
  else confidence = 'high';

  const claim =
    inputs.decision === 'accepted'
      ? 'The proposed change was authorized, model-traceable, in-scope, policy-compliant, causally valid, independently verified, evidence-complete, and recoverable — and has earned the right to proceed.'
      : 'The proposed change did NOT satisfy all assurance gates and is refused.';

  return {
    claim,
    argument,
    evidence: inputs.evidenceRefs,
    assumptions: inputs.assumptions,
    counter_evidence: counter,
    residual_risk: inputs.residualRisk,
    confidence,
    invalidating_conditions: [
      'model element changed',
      'source commit changed',
      'artifact digest changed',
      'policy bundle changed',
      'verifier version changed',
      'evidence freshness window elapsed',
    ],
    evidence_freshness: inputs.freshnessNote,
  };
}
