import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventStore, EventEmitter } from '../events/index.js';
import { FixedClock } from '../shared/index.js';
import {
  CausalGraph,
  evaluateRequired,
  evaluateForbidden,
  evaluateRecovery,
  evaluateConformance,
} from './index.js';

function chain() {
  const store = new EventStore();
  const em = new EventEmitter(store, new FixedClock('2026-06-01T00:00:00.000Z'));
  const a = em.emit({
    event_type: 'IntentAuthorized',
    actor_id: 'g',
    intent_id: 'INT-1',
    outcome: 'success',
  });
  const b = em.emit({
    event_type: 'CapabilityIssued',
    actor_id: 'b',
    intent_id: 'INT-1',
    outcome: 'success',
    parents: [a.event_id],
  });
  const c = em.emit({
    event_type: 'BuildStarted',
    actor_id: 'b',
    intent_id: 'INT-1',
    outcome: 'success',
    parents: [b.event_id],
  });
  em.emit({
    event_type: 'BuildCompleted',
    actor_id: 'b',
    intent_id: 'INT-1',
    outcome: 'success',
    parents: [c.event_id],
  });
  return store;
}

test('valid causal chain passes structural validation', () => {
  const g = new CausalGraph(chain().all().slice());
  assert.equal(g.validate().length, 0);
});

test('missing parent is detected', () => {
  const store = new EventStore();
  const em = new EventEmitter(store, new FixedClock());
  const e = em.emit({ event_type: 'X', actor_id: 'a', intent_id: 'INT-1', outcome: 'success' });
  // Fabricate an event with a non-existent parent.
  store.append({ ...e, event_id: 'EV-999', parent_event_ids: ['EV-does-not-exist'] });
  const g = new CausalGraph(store.all().slice());
  assert.ok(g.validate().some((r) => r.code === 'CAUSAL_INVALID'));
});

test('required causal sequence is satisfied', () => {
  const g = new CausalGraph(chain().all().slice());
  const r = evaluateRequired(g, 'IntentAuthorized->CapabilityIssued->BuildStarted->BuildCompleted');
  assert.ok(r.satisfied);
});

test('forbidden without-prior pattern is detected', () => {
  const store = new EventStore();
  const em = new EventEmitter(store, new FixedClock());
  // ProductionChanged with no prior IntentAuthorized/HumanApproval/Verification.
  em.emit({
    event_type: 'ProductionChanged',
    actor_id: 'b',
    intent_id: 'INT-1',
    outcome: 'success',
  });
  const g = new CausalGraph(store.all().slice());
  const r = evaluateForbidden(g, 'ProductionChangeWithoutApproval');
  assert.ok(!r.satisfied && r.reason?.code === 'FORBIDDEN_EVENT_PATTERN');
});

test('recovery obligation is unmet when no rollback/verify follows', () => {
  const store = new EventStore();
  const em = new EventEmitter(store, new FixedClock());
  em.emit({
    event_type: 'DeploymentStarted',
    actor_id: 'b',
    intent_id: 'INT-1',
    outcome: 'success',
  });
  const g = new CausalGraph(store.all().slice());
  const r = evaluateRecovery(g, 'DeploymentStarted~>(DeploymentVerified|RollbackCompleted)');
  assert.ok(!r.satisfied && r.reason?.code === 'RECOVERY_OBLIGATION_UNMET');
});

test('conformance aggregates required + forbidden + recovery', () => {
  const g = new CausalGraph(chain().all().slice());
  const conf = evaluateConformance(
    g,
    ['IntentAuthorized->BuildCompleted'],
    ['ProductionChangeWithoutApproval'],
    [],
  );
  assert.ok(conf.conformant);
});
