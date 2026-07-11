/**
 * Capability-lifecycle model (§14). Mirrors formal/tla/Capability.tla.
 *
 * Properties proven (as safety invariants over all reachable states):
 *   - A revoked capability cannot be used.
 *   - An expired capability cannot be used.
 *   - A capability cannot authorize an action outside its intent.
 *   - A single-use capability cannot be used twice.
 *   - A builder cannot issue its own capability.
 *
 * `broken` removes the use-time validity guard, modelling the H-5 hazard; the
 * checker then finds a reachable state where a revoked/expired capability was
 * used, demonstrating an unsafe transition is caught.
 */

import type { TransitionSystem } from './transition-system.js';

export interface CapState {
  issued: boolean;
  revoked: boolean;
  expired: boolean;
  uses: number;
  usedWhileInvalid: boolean;
  singleUse: boolean;
  boundToIntent: boolean;
  issuedByBuilder: boolean;
}

function key(s: CapState): string {
  return [
    s.issued,
    s.revoked,
    s.expired,
    s.uses,
    s.usedWhileInvalid,
    s.singleUse,
    s.boundToIntent,
    s.issuedByBuilder,
  ]
    .map((x) => (typeof x === 'boolean' ? (x ? '1' : '0') : x))
    .join('|');
}

export function capabilitySystem(broken = false): TransitionSystem<CapState> {
  // Explore all combinations of the "issuance context" booleans.
  const initial: CapState[] = [];
  for (const singleUse of [true, false]) {
    for (const boundToIntent of [true, false]) {
      for (const issuedByBuilder of [true, false]) {
        initial.push({
          issued: false,
          revoked: false,
          expired: false,
          uses: 0,
          usedWhileInvalid: false,
          singleUse,
          boundToIntent,
          issuedByBuilder,
        });
      }
    }
  }

  const maxUses = 2;

  return {
    name: `capability-lifecycle${broken ? '-BROKEN' : ''}`,
    initial,
    key,
    next(s: CapState): CapState[] {
      const out: CapState[] = [];
      // issue: correct model requires the capability be bound to the intent and
      // NOT issued by the builder. The broken model keeps issuance guards (the
      // injected fault is at USE time), so issuance stays correct here.
      if (!s.issued && s.boundToIntent && !s.issuedByBuilder) {
        out.push({ ...s, issued: true });
      }
      // consume
      if (s.issued && s.uses < maxUses) {
        const withinLimit = !s.singleUse || s.uses < 1;
        const validNow = !s.revoked && !s.expired;
        // correct model: only consume when valid AND within single-use limit.
        // broken model: consume regardless of validity (records the violation).
        if (broken || (validNow && withinLimit)) {
          out.push({
            ...s,
            uses: s.uses + 1,
            usedWhileInvalid: s.usedWhileInvalid || !validNow,
          });
        }
      }
      // revoke
      if (s.issued && !s.revoked) out.push({ ...s, revoked: true });
      // expire
      if (s.issued && !s.expired) out.push({ ...s, expired: true });
      return out;
    },
    invariants: [
      { name: 'revoked_or_expired_capability_never_used', holds: (s) => !s.usedWhileInvalid },
      { name: 'single_use_never_used_twice', holds: (s) => !s.singleUse || s.uses <= 1 },
      { name: 'issued_implies_bound_to_intent', holds: (s) => !s.issued || s.boundToIntent },
      {
        name: 'builder_never_issues_own_capability',
        holds: (s) => !s.issued || !s.issuedByBuilder,
      },
    ],
  };
}
