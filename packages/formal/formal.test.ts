import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkModel } from './transition-system.js';
import { capabilitySystem } from './capability-spec.js';
import { promotionSystem } from './promotion-spec.js';
import { runFormalChecks } from './check.js';

test('correct capability model has no invariant violations', () => {
  const r = checkModel(capabilitySystem(false));
  assert.ok(r.ok, JSON.stringify(r.violations));
});

test('BROKEN capability model is CAUGHT (revoked/expired use detected)', () => {
  const r = checkModel(capabilitySystem(true));
  assert.ok(!r.ok);
  assert.ok(r.violations.some((v) => v.invariant === 'revoked_or_expired_capability_never_used'));
});

test('correct promotion model has no invariant violations', () => {
  const r = checkModel(promotionSystem(false));
  assert.ok(r.ok, JSON.stringify(r.violations));
});

test('BROKEN promotion model is CAUGHT (promote before verify detected)', () => {
  const r = checkModel(promotionSystem(true));
  assert.ok(!r.ok);
  assert.ok(r.violations.some((v) => v.invariant === 'no_promotion_before_verification'));
});

test('runFormalChecks passes overall (correct safe, broken caught)', () => {
  assert.ok(runFormalChecks().ok);
});
