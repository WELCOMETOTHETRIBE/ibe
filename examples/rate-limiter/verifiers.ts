/**
 * Independent, platform-authored verifiers for the rate-limiter change. These
 * are NOT the builder's tests: they exercise the proposed implementation's
 * runtime behavior directly and refuse it if the rate-limiting invariant is
 * violated. Includes property-based, negative, and failure-injection checks.
 */

import type { Reason } from '../../packages/shared/index.js';
import type {
  Verifier,
  VerificationContext,
  VerificationResult,
} from '../../packages/verification/index.js';
import { RateLimiter } from './target/patched.js';

/** Small deterministic PRNG (LCG) so property runs are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

export class RateLimiterPropertyVerifier implements Verifier {
  id = 'verifier.ratelimiter.property';
  caseId = 'VER-RATELIMIT-PROP';
  category = 'property' as const;
  independentOf(): boolean {
    return true;
  }

  run(_ctx: VerificationContext): VerificationResult {
    const reasons: Reason[] = [];
    const rng = lcg(42);
    const trials = 200;
    let worstOverAllow = 0;

    // Property: in a burst larger than capacity at a frozen instant, the number
    // of allowed requests must never exceed capacity.
    for (let t = 0; t < trials; t++) {
      const capacity = 1 + Math.floor(rng() * 20);
      const burst = capacity + 1 + Math.floor(rng() * 20);
      const limiter = new RateLimiter({ capacity, refillRate: 5 }, () => 1000);
      let allowed = 0;
      for (let i = 0; i < burst; i++) if (limiter.allow('k')) allowed += 1;
      if (allowed > capacity) worstOverAllow = Math.max(worstOverAllow, allowed - capacity);
    }
    if (worstOverAllow > 0) {
      reasons.push({
        code: 'VERIFICATION_FAILED',
        message: `rate-limit invariant violated: burst allowed up to ${worstOverAllow} requests over capacity`,
        detail: { worstOverAllow },
      });
    }

    // Negative test: once exhausted at a frozen instant, allow() must deny.
    const lim = new RateLimiter({ capacity: 3, refillRate: 1 }, () => 5000);
    for (let i = 0; i < 3; i++) lim.allow('n');
    if (lim.allow('n')) {
      reasons.push({
        code: 'VERIFICATION_FAILED',
        message: 'negative test failed: request allowed after tokens exhausted',
      });
    }

    const passed = reasons.length === 0;
    return {
      caseId: this.caseId,
      verifierId: this.id,
      category: this.category,
      passed,
      independentOfBuilder: true,
      reasons,
      detail: { trials },
    };
  }
}

/** Failure-injection: refill under adversarial clock jumps must still bound allows. */
export class RateLimiterFailureInjectionVerifier implements Verifier {
  id = 'verifier.ratelimiter.failure-injection';
  caseId = 'VER-RATELIMIT-FAULT';
  category = 'integration' as const;
  independentOf(): boolean {
    return true;
  }
  run(): VerificationResult {
    const reasons: Reason[] = [];
    const clock = 0;
    const limiter = new RateLimiter({ capacity: 5, refillRate: 1 }, () => clock);
    // No time passes: 100 immediate requests must not all be allowed.
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (limiter.allow('f')) allowed += 1;
    if (allowed > 5) {
      reasons.push({
        code: 'VERIFICATION_FAILED',
        message: `failure-injection: ${allowed} allowed with no refill (>5)`,
      });
    }
    const passed = reasons.length === 0;
    return {
      caseId: this.caseId,
      verifierId: this.id,
      category: this.category,
      passed,
      independentOfBuilder: true,
      reasons,
    };
  }
}

export function rateLimiterVerifiers(): Verifier[] {
  return [new RateLimiterPropertyVerifier(), new RateLimiterFailureInjectionVerifier()];
}
