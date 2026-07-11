/**
 * Platform-required, builder-independent verifier plugins (§13). These verify
 * facts the kernel assembled (policy decision, causal conformance, evidence,
 * recovery) rather than trusting the builder's own test suite. Subject-specific
 * verifiers (e.g. the rate-limiter property test) live with their example.
 */

import type { Reason } from '../shared/index.js';
import type { Verifier, VerificationContext, VerificationResult } from './framework.js';

/** Base class for platform verifiers: independent of every builder by construction. */
abstract class PlatformVerifier implements Verifier {
  abstract id: string;
  abstract caseId: string;
  abstract category: VerificationResult['category'];
  independentOf(_builderId: string): boolean {
    return true; // authored by the platform, never the builder
  }
  abstract run(ctx: VerificationContext): VerificationResult;
  protected result(
    ctx: VerificationContext,
    passed: boolean,
    reasons: Reason[],
    detail?: Record<string, unknown>,
  ): VerificationResult {
    return {
      caseId: this.caseId,
      verifierId: this.id,
      category: this.category,
      passed,
      independentOfBuilder: this.independentOf(ctx.builderId),
      reasons,
      ...(detail ? { detail } : {}),
    };
  }
}

/** Fails unless the policy decision was allow. */
export class PolicyConformanceVerifier extends PlatformVerifier {
  id = 'verifier.policy';
  caseId = 'VER-POLICY';
  category = 'policy' as const;
  run(ctx: VerificationContext): VerificationResult {
    const decision = ctx.facts['policyDecision'] as
      | { decision?: string; reasons?: Reason[] }
      | undefined;
    const passed = decision?.decision === 'allow';
    return this.result(
      ctx,
      passed,
      passed
        ? []
        : (decision?.reasons ?? [{ code: 'POLICY_DENIED', message: 'policy did not allow' }]),
    );
  }
}

/** Fails unless the causal trace conforms (structural + required + forbidden + recovery). */
export class CausalConformanceVerifier extends PlatformVerifier {
  id = 'verifier.causal';
  caseId = 'VER-CAUSAL';
  category = 'causal-trace' as const;
  run(ctx: VerificationContext): VerificationResult {
    const conf = ctx.facts['causalConformance'] as
      | {
          conformant?: boolean;
          structural?: Reason[];
          forbidden?: Array<{ satisfied: boolean; reason?: Reason }>;
          required?: Array<{ satisfied: boolean; reason?: Reason }>;
        }
      | undefined;
    const passed = conf?.conformant === true;
    const reasons: Reason[] = [];
    if (!passed) {
      for (const r of conf?.structural ?? []) reasons.push(r);
      for (const p of [...(conf?.forbidden ?? []), ...(conf?.required ?? [])])
        if (!p.satisfied && p.reason) reasons.push(p.reason);
      if (reasons.length === 0)
        reasons.push({ code: 'CAUSAL_INVALID', message: 'causal conformance failed' });
    }
    return this.result(ctx, passed, reasons);
  }
}

/** Fails if any intent-required evidence type is missing or stale. */
export class EvidenceCompletenessVerifier extends PlatformVerifier {
  id = 'verifier.evidence';
  caseId = 'VER-EVIDENCE-COMPLETE';
  category = 'data-integrity' as const;
  run(ctx: VerificationContext): VerificationResult {
    const ev = ctx.facts['evidence'] as { missing?: string[]; stale?: string[] } | undefined;
    const missing = ev?.missing ?? [];
    const stale = ev?.stale ?? [];
    const passed = missing.length === 0 && stale.length === 0;
    const reasons: Reason[] = [];
    if (missing.length)
      reasons.push({
        code: 'EVIDENCE_INCOMPLETE',
        message: `missing evidence: ${missing.join(', ')}`,
        detail: { missing },
      });
    if (stale.length)
      reasons.push({
        code: 'EVIDENCE_STALE',
        message: `stale evidence: ${stale.join(', ')}`,
        detail: { stale },
      });
    return this.result(ctx, passed, reasons);
  }
}

/** Fails if recovery is required but was not tested/validated. */
export class RecoveryVerifier extends PlatformVerifier {
  id = 'verifier.recovery';
  caseId = 'VER-RECOVERY';
  category = 'recovery' as const;
  run(ctx: VerificationContext): VerificationResult {
    const rec = ctx.facts['recovery'] as { required?: boolean; tested?: boolean } | undefined;
    const passed = !rec?.required || rec?.tested === true;
    return this.result(
      ctx,
      passed,
      passed
        ? []
        : [{ code: 'RECOVERY_OBLIGATION_UNMET', message: 'recovery required but not validated' }],
    );
  }
}

/** Convenience: the standard platform verifier set. */
export function platformVerifiers(): Verifier[] {
  return [
    new PolicyConformanceVerifier(),
    new CausalConformanceVerifier(),
    new EvidenceCompletenessVerifier(),
    new RecoveryVerifier(),
  ];
}
