/**
 * Deterministic policy engine. Composes the rule set fail-closed and produces a
 * structured, hashable decision. The bundle hash is computed over a manifest of
 * rule ids/descriptions + version, so the exact policy that produced a decision
 * is recorded in evidence and verifiable later.
 */

import { digestOf, type Digest, type Reason } from '../shared/index.js';
import { RULES, POLICY_BUNDLE_VERSION } from './rules.js';
import type { CapabilityGrant, PolicyContext, PolicyDecision, PolicyRule } from './types.js';

export class DeterministicPolicyEngine {
  private readonly rules: PolicyRule[];
  private readonly version: string;
  private readonly bundleHashValue: Digest;

  constructor(rules: PolicyRule[] = RULES, version: string = POLICY_BUNDLE_VERSION) {
    // Freeze evaluation order deterministically by id for reproducibility.
    this.rules = [...rules].sort((a, b) => a.id.localeCompare(b.id));
    this.version = version;
    this.bundleHashValue = digestOf({
      version,
      rules: this.rules.map((r) => ({ id: r.id, description: r.description })),
    });
  }

  bundleHash(): Digest {
    return this.bundleHashValue;
  }
  bundleVersion(): string {
    return this.version;
  }

  evaluate(ctx: PolicyContext): PolicyDecision {
    const denies: Reason[] = [];
    const capabilities: CapabilityGrant[] = [];
    const conditions = new Set<string>();
    const requiredApprovals = new Set<string>();

    for (const rule of this.rules) {
      let contribution;
      try {
        contribution = rule.evaluate(ctx);
      } catch (e) {
        // A rule that throws is treated as a denial — fail closed.
        denies.push({
          code: 'POLICY_DENIED',
          message: `policy rule ${rule.id} errored: ${e instanceof Error ? e.message : String(e)}`,
        });
        continue;
      }
      if (contribution.denies?.length) denies.push(...contribution.denies);
      if (contribution.capabilities) capabilities.push(...contribution.capabilities);
      for (const c of contribution.conditions ?? []) conditions.add(c);
      for (const a of contribution.requiredApprovals ?? []) requiredApprovals.add(a);
    }

    const allow = denies.length === 0;
    return {
      decision: allow ? 'allow' : 'deny',
      reasons: denies,
      // Capabilities are only issued on an allow decision.
      capabilities: allow ? capabilities : [],
      conditions: allow ? [...conditions].sort() : [],
      required_approvals: [...requiredApprovals].sort(),
      policy_bundle_hash: this.bundleHashValue,
      policy_bundle_version: this.version,
    };
  }
}
