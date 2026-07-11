import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalIdentityProvider } from '../identity/index.js';
import { FixedClock, digestOf } from '../shared/index.js';
import { CapabilityBroker } from './index.js';

function setup() {
  const idp = new LocalIdentityProvider();
  idp.register('broker', 'service', ['capability_broker']);
  idp.register('builder', 'ai_agent', ['builder']);
  const clock = new FixedClock('2026-06-01T00:00:00.000Z');
  const broker = new CapabilityBroker(idp, 'broker', clock);
  const expect = {
    actorId: 'builder',
    action: 'terraform.plan',
    resource: 'staging',
    environment: 'staging',
  };
  const issue = () =>
    broker.issue({
      intentId: 'INT-1',
      intentHash: digestOf({ i: 1 }),
      actorId: 'builder',
      action: 'terraform.plan',
      resource: 'staging',
      environment: 'staging',
      modelVersion: 'm1',
      ttlSeconds: 600,
      singleUse: true,
    });
  return { idp, clock, broker, expect, issue };
}

test('issued capability validates against its exact binding', () => {
  const { broker, issue, expect } = setup();
  const cap = issue();
  assert.ok(cap.ok);
  assert.ok(broker.validate(cap.value, expect).ok);
});

test('binding mismatch is rejected', () => {
  const { broker, issue, expect } = setup();
  const cap = issue();
  assert.ok(cap.ok);
  const r = broker.validate(cap.value, { ...expect, action: 'terraform.apply' });
  assert.ok(!r.ok && r.error.code === 'CAPABILITY_INVALID');
});

test('expired capability is rejected', () => {
  const { broker, clock, issue, expect } = setup();
  const cap = issue();
  assert.ok(cap.ok);
  clock.advance(601_000);
  const r = broker.validate(cap.value, expect);
  assert.ok(!r.ok && r.error.code === 'CAPABILITY_EXPIRED');
});

test('revoked capability is rejected', () => {
  const { broker, issue, expect } = setup();
  const cap = issue();
  assert.ok(cap.ok);
  broker.revoke(cap.value.id, 'test');
  const r = broker.validate(cap.value, expect);
  assert.ok(!r.ok && r.error.code === 'CAPABILITY_REVOKED');
});

test('single-use capability cannot be consumed twice', () => {
  const { broker, issue, expect } = setup();
  const cap = issue();
  assert.ok(cap.ok);
  assert.ok(broker.use(cap.value, expect).ok);
  const r = broker.use(cap.value, expect);
  assert.ok(!r.ok && r.error.code === 'CAPABILITY_REPLAY');
});

test('broker cannot issue a capability to itself (self-approval)', () => {
  const { broker } = setup();
  const r = broker.issue({
    intentId: 'INT-1',
    intentHash: digestOf({ i: 1 }),
    actorId: 'broker',
    action: 'x.y',
    resource: 'r',
    environment: 'staging',
    modelVersion: 'm1',
    ttlSeconds: 60,
    singleUse: false,
  });
  assert.ok(!r.ok && r.error.code === 'SELF_APPROVAL');
});

test('a non-broker actor cannot issue capabilities', () => {
  const idp = new LocalIdentityProvider();
  idp.register('builder', 'ai_agent', ['builder']);
  idp.register('victim', 'service', []);
  const broker = new CapabilityBroker(idp, 'builder', new FixedClock());
  const r = broker.issue({
    intentId: 'INT-1',
    intentHash: digestOf({ i: 1 }),
    actorId: 'victim',
    action: 'x.y',
    resource: 'r',
    environment: 'staging',
    modelVersion: 'm1',
    ttlSeconds: 60,
    singleUse: false,
  });
  assert.ok(!r.ok && r.error.code === 'UNAUTHORIZED');
});

test('tampered capability fails signature verification', () => {
  const { broker, issue, expect } = setup();
  const cap = issue();
  assert.ok(cap.ok);
  const tampered = { ...cap.value, action: 'terraform.apply' };
  const r = broker.validate(tampered, { ...expect, action: 'terraform.apply' });
  assert.ok(!r.ok && r.error.code === 'SIGNATURE_INVALID');
});
