/**
 * Policy engine contracts.
 *
 * The policy engine is EXTERNAL to the builder and deterministic. It consumes a
 * fully-materialized context (intent, request, model impact, approvals, evidence
 * state) and returns a structured decision. Refusals carry factual,
 * machine-readable reasons. The engine never issues authority beyond what a rule
 * explicitly grants — it fails closed.
 */

import type { Reason } from '../shared/index.js';
import type { IntentContract } from '../intent/index.js';
import type { Digest } from '../shared/index.js';

export interface PolicyRequest {
  action: string;
  resource: string;
  environment: string;
}

export interface VerifierFact {
  id: string;
  independentOfBuilder: boolean;
  passed: boolean;
}

/** Everything a policy rule may read. Assembled by the orchestrator. */
export interface PolicyContext {
  now: number;
  actorId: string;
  builderId: string;
  intent: IntentContract;
  intentHash: Digest;
  request: PolicyRequest;
  /** Recorded approver identities (from human governors). */
  approvals: string[];
  model?: {
    trustBoundaryChanged: boolean;
    dataFlowViolations: Reason[];
    changedElementIds: string[];
  };
  cost?: { estimatedUsd: number };
  blastRadius?: string;
  evidencePresent?: string[];
  verifiers?: VerifierFact[];
  /** Explicit, audited break-glass request (still constrained by rules). */
  breakGlass?: boolean;
}

export interface CapabilityGrant {
  action: string;
  resource: string;
  environment: string;
  expires_in_seconds: number;
  single_use: boolean;
}

export interface RuleContribution {
  /** Non-empty → this rule denies. */
  denies?: Reason[];
  capabilities?: CapabilityGrant[];
  conditions?: string[];
  requiredApprovals?: string[];
}

export interface PolicyRule {
  id: string;
  description: string;
  evaluate(ctx: PolicyContext): RuleContribution;
}

export interface PolicyDecision {
  decision: 'allow' | 'deny';
  reasons: Reason[];
  capabilities: CapabilityGrant[];
  conditions: string[];
  required_approvals: string[];
  /** Bundle hash bound into evidence and certificates. */
  policy_bundle_hash: Digest;
  policy_bundle_version: string;
}
