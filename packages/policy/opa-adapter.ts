/**
 * Open Policy Agent adapter (§8).
 *
 * IBE's default engine is the dependency-free DeterministicPolicyEngine, but the
 * Rego bundles under /policies/** are the human-readable specification and can
 * be evaluated by a real OPA binary when present. This adapter shells out to
 * `opa eval` if `opa` is on PATH; otherwise it reports unavailability so callers
 * fall back to the built-in engine. It NEVER silently downgrades a deny.
 */

import { spawnSync } from 'node:child_process';
import type { PolicyContext, PolicyDecision } from './types.js';

export interface OpaAdapter {
  available(): boolean;
  evaluate(ctx: PolicyContext, entrypoint: string): PolicyDecision | null;
}

export class OpaCliAdapter implements OpaAdapter {
  constructor(private readonly bundleDir: string) {}

  available(): boolean {
    const r = spawnSync('opa', ['version'], { encoding: 'utf-8', timeout: 5000 });
    return r.status === 0;
  }

  evaluate(ctx: PolicyContext, entrypoint = 'data.ibe.decision'): PolicyDecision | null {
    if (!this.available()) return null;
    const input = JSON.stringify({
      action: ctx.request.action,
      resource: ctx.request.resource,
      environment: ctx.request.environment,
      intent: ctx.intent,
      approvals: ctx.approvals,
    });
    const r = spawnSync(
      'opa',
      ['eval', '--format', 'json', '--stdin-input', '--data', this.bundleDir, entrypoint],
      { input, encoding: 'utf-8', timeout: 15000 },
    );
    if (r.status !== 0) return null;
    try {
      const parsed = JSON.parse(r.stdout);
      const value = parsed?.result?.[0]?.expressions?.[0]?.value;
      if (!value || typeof value.decision !== 'string') return null;
      return value as PolicyDecision;
    } catch {
      return null;
    }
  }
}
