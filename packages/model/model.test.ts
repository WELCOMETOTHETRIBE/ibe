import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateModel,
  computeModelDelta,
  checkInformationFlows,
  validateComposition,
} from './index.js';

const cuiModel = {
  model_version: 'v1',
  name: 'cui',
  elements: [
    {
      kind: 'Component',
      id: 'CMP-VAULT',
      version: '1',
      name: 'Vault',
      owner: 'o',
      relationships: [{ type: 'exposes', target: 'IF-PUB' }],
    },
    {
      kind: 'Interface',
      id: 'IF-PUB',
      version: '1',
      name: 'endpoint',
      owner: 'o',
      public: true,
      relationships: [],
    },
    {
      kind: 'DataFlow',
      id: 'DF-CUI',
      version: '1',
      name: 'cui out',
      owner: 'o',
      classification: 'CUI',
      from: 'CMP-VAULT',
      to: 'IF-PUB',
      transport: 'https',
      encrypted: true,
      relationships: [],
    },
  ],
};

test('a valid model loads and validates', () => {
  const r = validateModel(cuiModel);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
});

test('CUI flow to a public endpoint is a violation', () => {
  const r = validateModel(cuiModel);
  assert.ok(r.ok);
  const findings = checkInformationFlows(r.value);
  assert.ok(findings.some((f) => f.reason.code === 'INFORMATION_FLOW_VIOLATION'));
});

test('model delta detects modified elements and hashes', () => {
  const a = validateModel(cuiModel);
  const proposed = structuredClone(cuiModel);
  proposed.model_version = 'v2';
  (proposed.elements[0] as { version: string }).version = '2';
  const b = validateModel(proposed);
  assert.ok(a.ok && b.ok);
  const delta = computeModelDelta(a.value, b.value);
  assert.ok(delta.modified.some((m) => m.id === 'CMP-VAULT'));
  assert.ok(delta.deltaHash.startsWith('sha256:'));
});

test('impact analysis finds verification cases and requirements', () => {
  const model = {
    model_version: 'v1',
    name: 'x',
    elements: [
      {
        kind: 'Requirement',
        id: 'RQ-1',
        version: '1',
        name: 'r',
        owner: 'o',
        relationships: [{ type: 'allocatedTo', target: 'CMP-1' }],
      },
      { kind: 'Component', id: 'CMP-1', version: '1', name: 'c', owner: 'o', relationships: [] },
      {
        kind: 'Invariant',
        id: 'INV-1',
        version: '1',
        name: 'i',
        owner: 'o',
        relationships: [{ type: 'constrains', target: 'CMP-1' }],
      },
      {
        kind: 'Hazard',
        id: 'HZ-1',
        version: '1',
        name: 'h',
        owner: 'o',
        relationships: [{ type: 'mitigatedBy', target: 'INV-1' }],
      },
      {
        kind: 'VerificationCase',
        id: 'VER-1',
        version: '1',
        name: 'v',
        owner: 'o',
        method: 'unit',
        relationships: [{ type: 'verifies', target: 'CMP-1' }],
      },
    ],
  };
  const r = validateModel(model);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
  const impact = r.value.impactOf(['CMP-1']);
  assert.ok(impact.verificationCasesToRerun.includes('VER-1'));
  assert.ok(impact.requirementsTouched.includes('RQ-1'));
  assert.ok(impact.relevantHazards.includes('HZ-1'));
});

test('assume-guarantee composition surfaces an unmet assumption', () => {
  const model = {
    model_version: 'v1',
    name: 'x',
    elements: [
      {
        kind: 'Component',
        id: 'CMP-A',
        version: '1',
        name: 'a',
        owner: 'o',
        relationships: [{ type: 'dependsOn', target: 'CMP-B' }],
        contract: {
          assumptions: ['encrypted persistence'],
          guarantees: [],
          on_assumption_failure: [],
        },
      },
      {
        kind: 'Component',
        id: 'CMP-B',
        version: '1',
        name: 'b',
        owner: 'o',
        relationships: [],
        contract: {
          assumptions: [],
          guarantees: ['audit event emitted'],
          on_assumption_failure: [],
        },
      },
    ],
  };
  const r = validateModel(model);
  assert.ok(r.ok);
  const findings = validateComposition(r.value);
  assert.ok(findings.some((f) => f.assumption === 'encrypted persistence'));
});
