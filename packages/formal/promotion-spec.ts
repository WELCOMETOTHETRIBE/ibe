/**
 * Promotion-lifecycle model (§14). Mirrors formal/tla/Promotion.tla.
 *
 * Safety properties:
 *   - Production promotion cannot occur before verification.
 *   - A refused change cannot be promoted.
 *   - The builder cannot mark itself independently verified.
 * Terminal (bounded-liveness) property:
 *   - A failed/started deployment eventually reaches rollback or a safe state.
 *
 * `broken` removes the "verified before promote" guard (hazard H-3); the checker
 * finds a reachable promoted-without-verification state.
 */

import type { TransitionSystem } from './transition-system.js';

export interface PromState {
  built: boolean;
  verified: boolean;
  builderSelfVerified: boolean;
  approved: boolean;
  refused: boolean;
  promoted: boolean;
  deployStarted: boolean;
  deployVerified: boolean;
  rolledBack: boolean;
  independentVerifierAvailable: boolean;
}

function key(s: PromState): string {
  return Object.values(s)
    .map((x) => (x ? '1' : '0'))
    .join('');
}

export function promotionSystem(broken = false): TransitionSystem<PromState> {
  const initial: PromState[] = [];
  for (const independentVerifierAvailable of [true, false]) {
    initial.push({
      built: false,
      verified: false,
      builderSelfVerified: false,
      approved: false,
      refused: false,
      promoted: false,
      deployStarted: false,
      deployVerified: false,
      rolledBack: false,
      independentVerifierAvailable,
    });
  }

  return {
    name: `promotion-lifecycle${broken ? '-BROKEN' : ''}`,
    initial,
    key,
    next(s: PromState): PromState[] {
      const out: PromState[] = [];
      if (!s.built && !s.refused) out.push({ ...s, built: true });
      // verify: only an independent verifier may set `verified`. A builder
      // self-verify sets builderSelfVerified but must NOT count as verified.
      if (s.built && !s.verified && !s.refused) {
        if (s.independentVerifierAvailable) out.push({ ...s, verified: true });
        // builder attempts self-verification
        out.push({ ...s, builderSelfVerified: true });
      }
      if (s.built && !s.approved && !s.refused) out.push({ ...s, approved: true });
      // refuse can happen anytime before promotion
      if (!s.promoted && !s.refused) out.push({ ...s, refused: true });
      // promote: correct model requires verified && approved && !refused.
      if (!s.promoted && s.approved) {
        const guard = broken ? !s.refused : s.verified && !s.refused;
        if (guard) out.push({ ...s, promoted: true, deployStarted: true });
      }
      // deploy verify / rollback
      if (s.deployStarted && !s.deployVerified && !s.rolledBack) {
        out.push({ ...s, deployVerified: true });
        out.push({ ...s, rolledBack: true });
      }
      return out;
    },
    invariants: [
      { name: 'no_promotion_before_verification', holds: (s) => !s.promoted || s.verified },
      { name: 'refused_change_never_promoted', holds: (s) => !(s.promoted && s.refused) },
      {
        name: 'builder_self_verify_does_not_imply_verified',
        holds: (s) => !(s.builderSelfVerified && s.verified && !s.independentVerifierAvailable),
      },
    ],
    terminalInvariants: [
      {
        name: 'started_deployment_reaches_verified_or_rollback',
        holds: (s) => !s.deployStarted || s.deployVerified || s.rolledBack,
      },
    ],
  };
}
