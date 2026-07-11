import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIntent, evaluateIntentValidity, migrateV1ToV2, type IntentV1 } from './index.js';
import { FixedClock } from '../shared/index.js';

const base = {
  schema_version: '2.0',
  intent: {
    id: 'INT-1',
    title: 'Test intent',
    objective: 'Ensure the widget count never exceeds the configured maximum.',
    owner: { id: 'human-a', type: 'human' },
    created_at: '2026-01-01T00:00:00.000Z',
    expires_at: '2026-12-31T00:00:00.000Z',
  },
  authority: {
    requested_by: 'human-a',
    approved_by: ['human-gov'],
    allowed_actions: ['repository.write_branch'],
    approval_required: ['production.promote'],
    prohibited_actions: ['self_approve', 'policy.modify'],
  },
  scope: {
    repositories: ['r'],
    branches: ['b'],
    files: ['src/a.ts'],
    functions: ['f'],
    model_elements: [],
    environments: ['staging'],
    exclusions: [],
  },
  requirements: { satisfies: [], preserves: [] },
  invariants: [],
  risk: {
    level: 'low',
    tolerance: 'strict',
    maximum_blast_radius: 'staging-only',
    maximum_cost_usd: 0,
  },
  expected_events: [],
  forbidden_event_patterns: [],
  verification: { required_cases: [], minimum_independent_verifiers: 1 },
  recovery: {
    required: false,
    strategy: 'none',
    maximum_recovery_time_seconds: 60,
    safe_state: 'prev',
  },
  evidence: { required_types: ['policy-decision'] },
};

test('a well-formed intent validates', () => {
  const r = validateIntent(base);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
});

test('missing self_approve prohibition fails completeness', () => {
  const bad = structuredClone(base);
  bad.authority.prohibited_actions = ['policy.modify'];
  const r = validateIntent(bad);
  assert.ok(!r.ok);
  assert.ok(r.error.some((e) => /self_approve/.test(e.message)));
});

test('unknown top-level key is rejected (strict schema)', () => {
  const bad = { ...structuredClone(base), injected: true } as unknown;
  const r = validateIntent(bad);
  assert.ok(!r.ok);
});

test('high-risk intent without verification/recovery is refused', () => {
  const bad = structuredClone(base);
  bad.risk.level = 'high';
  const r = validateIntent(bad);
  assert.ok(!r.ok);
});

test('expiry is evaluated against the clock', () => {
  const r = validateIntent(base);
  assert.ok(r.ok);
  const past = new FixedClock('2027-01-01T00:00:00.000Z');
  assert.ok(!evaluateIntentValidity(r.value.contract, past).ok);
  const now = new FixedClock('2026-06-01T00:00:00.000Z');
  assert.ok(evaluateIntentValidity(r.value.contract, now).ok);
});

test('v1 intent migrates to a valid v2 contract', () => {
  const v1: IntentV1 = {
    goal: 'Ensure allow count stays within capacity limit.',
    scope: { files: ['target-service/patched/rate-limiter.ts'], functions: ['allow'] },
    invariants: [{ name: 'cap', metric_path: 'allow_count', operator: 'le', threshold: 10 }],
    risk_tolerance: 'strict',
    test_inputs: [{ action: 'allow', key: 'a' }],
  };
  const migrated = migrateV1ToV2(v1);
  const r = validateIntent(migrated);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
});
