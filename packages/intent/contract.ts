/**
 * Intent Contract v2 — the machine-checkable, versioned contract that binds a
 * proposed change to an authorized human intent. Generalized from the original
 * rate-limiter-specific schema to cover both software and infrastructure change.
 *
 * Validation is performed with Zod so that malformed, partial, or hostile input
 * fails closed with structured, machine-readable errors — never a silent coerce.
 */

import { z } from 'zod';

/** Dotted action identifier, e.g. `repository.write_branch`, `terraform.plan`,
 * or a bare governance token such as `self_approve`. */
export const ActionId = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/, 'action must be lower_snake, optionally dotted');

export const StableId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]*$/, 'ids must be alnum with _.:- separators');

const Iso8601 = z.string().datetime({ offset: true }).describe('ISO-8601 timestamp with timezone');

export const OwnerType = z.enum(['human', 'service', 'ai_agent']);

export const RiskLevel = z.enum(['low', 'medium', 'high', 'critical']);
export const RiskTolerance = z.enum(['strict', 'moderate', 'permissive']);

export const EvidenceType = z.enum([
  'source-diff',
  'policy-decision',
  'test-results',
  'causal-trace',
  'artifact-digest',
  'verifier-attestation',
  'provenance',
  'model-delta',
  'oscal',
]);

/** How an invariant is evaluated. `policy` → OPA/kernel rule; `metric` → runtime
 * metric threshold (the original v1 model); `model` → model-graph query. */
export const InvariantEvaluator = z.object({
  type: z.enum(['policy', 'metric', 'model', 'causal', 'property']),
  reference: z.string().min(1).max(200),
  /** Optional threshold form for `metric` evaluators (v1 compatibility). */
  operator: z.enum(['lt', 'le', 'eq', 'ge', 'gt', 'ne']).optional(),
  threshold: z.number().finite().optional(),
});

export const Invariant = z.object({
  id: StableId,
  description: z.string().min(3).max(500),
  evaluator: InvariantEvaluator,
});

export const IntentHeader = z.object({
  id: StableId,
  title: z.string().min(3).max(200),
  objective: z.string().min(10).max(2000),
  owner: z.object({ id: StableId, type: OwnerType }),
  created_at: Iso8601,
  expires_at: Iso8601,
});

export const Authority = z.object({
  requested_by: StableId,
  approved_by: z.array(StableId).default([]),
  allowed_actions: z.array(ActionId).default([]),
  approval_required: z.array(ActionId).default([]),
  prohibited_actions: z.array(ActionId).default([]),
});

export const Scope = z.object({
  repositories: z.array(z.string().min(1)).default([]),
  branches: z.array(z.string().min(1)).default([]),
  files: z.array(z.string().min(1)).default([]),
  functions: z.array(z.string().min(1)).default([]),
  model_elements: z.array(StableId).default([]),
  environments: z.array(z.string().min(1)).default([]),
  exclusions: z.array(z.string().min(1)).default([]),
});

export const Requirements = z.object({
  satisfies: z.array(StableId).default([]),
  preserves: z.array(StableId).default([]),
});

export const Risk = z.object({
  level: RiskLevel,
  tolerance: RiskTolerance,
  maximum_blast_radius: z.string().min(1).max(120),
  maximum_cost_usd: z.number().finite().nonnegative().default(0),
});

export const Verification = z.object({
  required_cases: z.array(StableId).default([]),
  minimum_independent_verifiers: z.number().int().nonnegative().default(1),
});

export const Recovery = z.object({
  required: z.boolean(),
  strategy: z.enum(['rollback', 'safe-degrade', 'quarantine', 'none']),
  maximum_recovery_time_seconds: z.number().int().positive().max(86_400),
  safe_state: z.string().min(1).max(200),
});

export const Evidence = z.object({
  required_types: z.array(EvidenceType).default([]),
});

/**
 * The full contract. `.strict()` at the top level rejects unknown top-level keys
 * so that typos or injected fields fail closed rather than being ignored.
 */
export const IntentContractV2 = z
  .object({
    schema_version: z.literal('2.0'),
    intent: IntentHeader,
    authority: Authority,
    scope: Scope,
    requirements: Requirements.default({ satisfies: [], preserves: [] }),
    invariants: z.array(Invariant).default([]),
    risk: Risk,
    expected_events: z.array(z.string().min(1)).default([]),
    forbidden_event_patterns: z.array(z.string().min(1)).default([]),
    verification: Verification,
    recovery: Recovery,
    evidence: Evidence,
  })
  .strict();

export type IntentContract = z.infer<typeof IntentContractV2>;
export type ActionIdT = z.infer<typeof ActionId>;
export type InvariantT = z.infer<typeof Invariant>;
export type EvidenceTypeT = z.infer<typeof EvidenceType>;
export type RiskToleranceT = z.infer<typeof RiskTolerance>;
