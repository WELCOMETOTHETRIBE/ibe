import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIntent, type IntentContract } from '../intent/index.js';
import { digestOf } from '../shared/index.js';
import { DeterministicPolicyEngine, type PolicyContext } from './index.js';

const raw = {
  schema_version: '2.0',
  intent: {
    id: 'INT-P',
    title: 'Policy test',
    objective: 'Ensure the deployment stays within the staging environment boundary.',
    owner: { id: 'human-a', type: 'human' },
    created_at: '2026-01-01T00:00:00.000Z',
    expires_at: '2026-12-31T00:00:00.000Z',
  },
  authority: {
    requested_by: 'human-a',
    approved_by: ['human-gov'],
    allowed_actions: ['terraform.plan', 'test.execute'],
    approval_required: ['production.promote'],
    prohibited_actions: ['self_approve', 'policy.modify', 'secret.export'],
  },
  scope: {
    repositories: ['r'],
    branches: ['b'],
    files: ['infra/**'],
    functions: [],
    model_elements: [],
    environments: ['staging'],
    exclusions: ['production'],
  },
  requirements: { satisfies: [], preserves: [] },
  invariants: [],
  risk: {
    level: 'medium',
    tolerance: 'strict',
    maximum_blast_radius: 'staging-only',
    maximum_cost_usd: 50,
  },
  expected_events: [],
  forbidden_event_patterns: [],
  verification: { required_cases: [], minimum_independent_verifiers: 1 },
  recovery: {
    required: true,
    strategy: 'rollback',
    maximum_recovery_time_seconds: 600,
    safe_state: 'prev',
  },
  evidence: { required_types: ['policy-decision'] },
};

function contract(): IntentContract {
  const r = validateIntent(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value.contract;
}

function ctx(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    now: Date.parse('2026-06-01T00:00:00.000Z'),
    actorId: 'builder',
    builderId: 'builder',
    intent: contract(),
    intentHash: digestOf({ i: 1 }),
    request: { action: 'terraform.plan', resource: 'staging', environment: 'staging' },
    approvals: ['human-gov'],
    ...over,
  };
}

test('an allowed action in the right environment is permitted with a capability', () => {
  const d = new DeterministicPolicyEngine().evaluate(ctx());
  assert.equal(d.decision, 'allow');
  assert.ok(d.capabilities.length === 1);
  assert.ok(d.conditions.includes('network-deny-by-default'));
});

test('a prohibited action is denied', () => {
  const d = new DeterministicPolicyEngine().evaluate(
    ctx({ request: { action: 'secret.export', resource: 'x', environment: 'staging' } }),
  );
  assert.equal(d.decision, 'deny');
  assert.ok(d.reasons.some((r) => r.code === 'POLICY_DENIED'));
});

test('an excluded environment is denied', () => {
  const d = new DeterministicPolicyEngine().evaluate(
    ctx({ request: { action: 'terraform.plan', resource: 'x', environment: 'production' } }),
  );
  assert.equal(d.decision, 'deny');
  assert.ok(d.reasons.some((r) => r.code === 'OUT_OF_SCOPE'));
});

test('production promotion without verification is denied', () => {
  const d = new DeterministicPolicyEngine().evaluate(
    ctx({
      request: { action: 'production.promote', resource: 'prod', environment: 'staging' },
      verifiers: [],
    }),
  );
  assert.equal(d.decision, 'deny');
});

test('information-flow violations deny the action', () => {
  const d = new DeterministicPolicyEngine().evaluate(
    ctx({
      model: {
        trustBoundaryChanged: false,
        dataFlowViolations: [{ code: 'INFORMATION_FLOW_VIOLATION', message: 'CUI leak' }],
        changedElementIds: [],
      },
    }),
  );
  assert.equal(d.decision, 'deny');
});

test('policy bundle hash is deterministic', () => {
  assert.equal(
    new DeterministicPolicyEngine().bundleHash(),
    new DeterministicPolicyEngine().bundleHash(),
  );
});
