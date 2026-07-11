/**
 * Independent verification framework (§13).
 *
 * Verification is SEPARATE from the builder. A verifier declares whether it is
 * independent of the builder identity; the platform requires a minimum number of
 * independent, passing verifiers before promotion. Builder-provided tests are
 * allowed to run, but they cannot by themselves satisfy the independence
 * requirement — the kernel counts only independent passes.
 */

import type { Reason } from '../shared/index.js';

export type VerificationCategory =
  | 'unit'
  | 'integration'
  | 'property'
  | 'policy'
  | 'security'
  | 'static'
  | 'plan'
  | 'runtime'
  | 'data-integrity'
  | 'causal-trace'
  | 'model'
  | 'recovery';

/** What verifiers may read. Populated by the orchestrator per execution. */
export interface VerificationContext {
  builderId: string;
  intentId: string;
  /** Arbitrary, verifier-specific inputs (metrics, decisions, conformance…). */
  facts: Record<string, unknown>;
}

export interface VerificationResult {
  caseId: string;
  verifierId: string;
  category: VerificationCategory;
  passed: boolean;
  independentOfBuilder: boolean;
  reasons: Reason[];
  /** Non-secret detail bound into evidence. */
  detail?: Record<string, unknown>;
}

export interface Verifier {
  id: string;
  caseId: string;
  category: VerificationCategory;
  /** True when this verifier is not authored/controlled by the builder. */
  independentOf(builderId: string): boolean;
  run(ctx: VerificationContext): VerificationResult | Promise<VerificationResult>;
}

export interface VerificationSummary {
  results: VerificationResult[];
  passedCaseIds: string[];
  failedCaseIds: string[];
  independentPassed: number;
  allPassed: boolean;
}

export class VerifierRegistry {
  private readonly verifiers: Verifier[] = [];
  register(v: Verifier): this {
    this.verifiers.push(v);
    return this;
  }
  list(): readonly Verifier[] {
    return this.verifiers;
  }

  async runAll(ctx: VerificationContext): Promise<VerificationSummary> {
    const results: VerificationResult[] = [];
    for (const v of this.verifiers) {
      try {
        results.push(await v.run(ctx));
      } catch (e) {
        results.push({
          caseId: v.caseId,
          verifierId: v.id,
          category: v.category,
          passed: false,
          independentOfBuilder: v.independentOf(ctx.builderId),
          reasons: [
            {
              code: 'VERIFICATION_FAILED',
              message: `verifier ${v.id} threw: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
        });
      }
    }
    const passedCaseIds = results.filter((r) => r.passed).map((r) => r.caseId);
    const failedCaseIds = results.filter((r) => !r.passed).map((r) => r.caseId);
    const independentPassed = results.filter((r) => r.passed && r.independentOfBuilder).length;
    return {
      results,
      passedCaseIds: [...new Set(passedCaseIds)],
      failedCaseIds: [...new Set(failedCaseIds)],
      independentPassed,
      allPassed: failedCaseIds.length === 0,
    };
  }
}

/** Independence gate: are there enough independent, passing verifiers? */
export function checkIndependence(
  summary: VerificationSummary,
  minimumIndependent: number,
): Reason[] {
  const reasons: Reason[] = [];
  if (summary.independentPassed < minimumIndependent) {
    reasons.push({
      code: 'VERIFIER_NOT_INDEPENDENT',
      message: `need ${minimumIndependent} independent passing verifier(s); have ${summary.independentPassed}`,
      detail: { independentPassed: summary.independentPassed, required: minimumIndependent },
    });
  }
  return reasons;
}
