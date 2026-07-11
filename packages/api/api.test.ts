import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createIbeServer } from './server.js';

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = createIbeServer();
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test('GET /health returns ok', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });
});

test('GET /formal/check passes', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/formal/check`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.ok(body.ok);
  });
});

test('POST /intents/validate rejects a malformed intent with 422', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/intents/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ schema_version: '2.0' }),
    });
    assert.equal(res.status, 422);
  });
});

test('POST /policy/evaluate denies a prohibited action with 422', async () => {
  await withServer(async (base) => {
    const intent = {
      schema_version: '2.0',
      intent: {
        id: 'INT-API',
        title: 'api test',
        objective: 'Ensure the staging deployment stays within the authorized boundary.',
        owner: { id: 'human-a', type: 'human' },
        created_at: '2026-01-01T00:00:00.000Z',
        expires_at: '2026-12-31T00:00:00.000Z',
      },
      authority: {
        requested_by: 'human-a',
        approved_by: ['human-gov'],
        allowed_actions: ['terraform.plan'],
        approval_required: [],
        prohibited_actions: ['self_approve', 'policy.modify', 'secret.export'],
      },
      scope: {
        repositories: ['r'],
        branches: ['b'],
        files: ['infra/**'],
        functions: [],
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
        safe_state: 'p',
      },
      evidence: { required_types: ['policy-decision'] },
    };
    const res = await fetch(`${base}/policy/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ intent, action: 'secret.export', environment: 'staging' }),
    });
    assert.equal(res.status, 422);
  });
});
