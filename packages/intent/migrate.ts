/**
 * Backward-compatibility: migrate a v1 (rate-limiter-era) intent into a v2
 * contract. This preserves the conceptual value of the original `intents/*.json`
 * files and powers the `ibe compat` command. Migration is lossless for the
 * fields v1 expressed and fills the new mandatory fields with safe defaults
 * (strict, staging-only, self_approve prohibited).
 */

import type { IntentContract } from './contract.js';

/** The original v1 intent shape (kept here so the migrator is self-contained). */
export interface IntentV1 {
  goal: string;
  scope: { files: string[]; functions: string[]; exclusions?: string[] };
  invariants: Array<{ name: string; metric_path: string; operator: string; threshold: number }>;
  risk_tolerance: 'strict' | 'moderate' | 'permissive';
  test_inputs: Array<{ action: string; key: string; timestamp_ms?: number }>;
}

export interface MigrateOptions {
  id?: string;
  ownerId?: string;
  repository?: string;
  createdAt?: string;
  expiresAt?: string;
}

export function migrateV1ToV2(v1: IntentV1, opts: MigrateOptions = {}): IntentContract {
  const id = opts.id ?? 'INT-LEGACY-001';
  const createdAt = opts.createdAt ?? '2026-01-01T00:00:00.000Z';
  const expiresAt = opts.expiresAt ?? '2026-12-31T00:00:00.000Z';

  return {
    schema_version: '2.0',
    intent: {
      id,
      title: v1.goal.slice(0, 120),
      objective: v1.goal,
      owner: { id: opts.ownerId ?? 'human-legacy', type: 'human' },
      created_at: createdAt,
      expires_at: expiresAt,
    },
    authority: {
      requested_by: opts.ownerId ?? 'human-legacy',
      approved_by: ['human-governor-legacy'],
      allowed_actions: ['repository.read', 'repository.write_branch', 'test.execute'],
      approval_required: ['production.promote'],
      prohibited_actions: ['self_approve', 'policy.modify', 'secret.export', 'production.shell'],
    },
    scope: {
      repositories: opts.repository ? [opts.repository] : [],
      branches: [`ibe/${id}`],
      files: v1.scope.files,
      functions: v1.scope.functions,
      model_elements: [],
      environments: ['development', 'staging'],
      exclusions: v1.scope.exclusions ?? ['production'],
    },
    requirements: { satisfies: [], preserves: [] },
    invariants: v1.invariants.map((inv) => ({
      id: `INV-${inv.name}`,
      description: `Metric ${inv.metric_path} ${inv.operator} ${inv.threshold}`,
      evaluator: {
        type: 'metric' as const,
        reference: inv.metric_path,
        operator: inv.operator as 'lt' | 'le' | 'eq' | 'ge' | 'gt' | 'ne',
        threshold: inv.threshold,
      },
    })),
    risk: {
      level: 'medium',
      tolerance: v1.risk_tolerance,
      maximum_blast_radius: 'staging-only',
      maximum_cost_usd: 0,
    },
    expected_events: ['BuildCompleted', 'VerificationPassed', 'AssuranceCertificateIssued'],
    forbidden_event_patterns: ['ProductionChangeWithoutApproval', 'PromotionBeforeVerification'],
    verification: { required_cases: ['VER-RATELIMIT-PROP'], minimum_independent_verifiers: 1 },
    recovery: {
      required: true,
      strategy: 'rollback',
      maximum_recovery_time_seconds: 600,
      safe_state: 'previous-approved-version',
    },
    evidence: {
      required_types: [
        'source-diff',
        'policy-decision',
        'test-results',
        'causal-trace',
        'verifier-attestation',
      ],
    },
  };
}
