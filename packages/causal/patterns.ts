/**
 * Causal pattern evaluation (§12): required event patterns, forbidden patterns,
 * and eventual-recovery obligations. Pattern strings from intents and hazard
 * derivations are parsed into structured forms and checked against a CausalGraph.
 *
 * Grammar:
 *   A->B->C            required causal sequence (each stage causally after prior)
 *   T~>(A|B)           recovery: every T must causally lead to an A or B
 *   NamedForbidden     looked up in FORBIDDEN_CATALOG, else "no event of this type"
 */

import { Reason, reason } from '../shared/index.js';
import type { CausalGraph } from './graph.js';

export type Pattern =
  | { kind: 'sequence'; source: string; types: string[] }
  | { kind: 'without-prior'; source: string; event: string; requiredPriors: string[] }
  | { kind: 'forbidden-type'; source: string; event: string }
  | { kind: 'recovery'; source: string; trigger: string; satisfiedBy: string[] };

/** Named forbidden patterns → structured definitions (§12 examples). */
export const FORBIDDEN_CATALOG: Record<string, Pattern> = {
  ProductionChangeWithoutApproval: {
    kind: 'without-prior',
    source: 'ProductionChangeWithoutApproval',
    event: 'ProductionChanged',
    requiredPriors: ['IntentAuthorized', 'HumanApprovalRecorded', 'VerificationPassed'],
  },
  PromotionBeforeVerification: {
    kind: 'without-prior',
    source: 'PromotionBeforeVerification',
    event: 'ProductionPromoted',
    requiredPriors: ['VerificationPassed'],
  },
  UnauthorizedSecretRead: {
    kind: 'forbidden-type',
    source: 'UnauthorizedSecretRead',
    event: 'UnauthorizedSecretRead',
  },
  RevokedCapabilityUsed: {
    kind: 'forbidden-type',
    source: 'RevokedCapabilityUsed',
    event: 'RevokedCapabilityUsed',
  },
  CapabilityExceedsIntent: {
    kind: 'forbidden-type',
    source: 'CapabilityExceedsIntent',
    event: 'CapabilityExceedsIntent',
  },
  BuilderModifiedOwnPolicy: {
    kind: 'forbidden-type',
    source: 'BuilderModifiedOwnPolicy',
    event: 'BuilderModifiedOwnPolicy',
  },
};

export function parsePattern(spec: string): Pattern {
  const s = spec.trim();
  const recovery = /^(.+?)~>\((.+)\)$/.exec(s);
  if (recovery) {
    return {
      kind: 'recovery',
      source: s,
      trigger: recovery[1]!.trim(),
      satisfiedBy: recovery[2]!.split('|').map((x) => x.trim()),
    };
  }
  if (s.includes('->')) {
    return { kind: 'sequence', source: s, types: s.split('->').map((x) => x.trim()) };
  }
  if (FORBIDDEN_CATALOG[s]) return FORBIDDEN_CATALOG[s]!;
  return { kind: 'forbidden-type', source: s, event: s };
}

export interface PatternResult {
  pattern: string;
  kind: Pattern['kind'];
  satisfied: boolean;
  reason?: Reason;
}

/** Does a causal chain of the given types exist (each stage after the prior)? */
export function existsCausalChain(graph: CausalGraph, types: string[]): boolean {
  if (types.length === 0) return true;
  let reachable = new Set(graph.ofType(types[0]!).map((e) => e.event_id));
  if (reachable.size === 0) return false;
  for (let i = 1; i < types.length; i++) {
    const next = new Set<string>();
    for (const e of graph.ofType(types[i]!)) {
      for (const a of graph.ancestors(e.event_id)) {
        if (reachable.has(a)) {
          next.add(e.event_id);
          break;
        }
      }
    }
    if (next.size === 0) return false;
    reachable = next;
  }
  return true;
}

/** Evaluate a single required pattern (must hold). */
export function evaluateRequired(graph: CausalGraph, spec: string): PatternResult {
  const pattern = parsePattern(spec);
  if (pattern.kind === 'sequence') {
    const ok = existsCausalChain(graph, pattern.types);
    return {
      pattern: spec,
      kind: pattern.kind,
      satisfied: ok,
      ...(ok
        ? {}
        : {
            reason: reason(
              'REQUIRED_PATTERN_MISSING',
              `required causal sequence not found: ${spec}`,
            ),
          }),
    };
  }
  if (pattern.kind === 'recovery') {
    return evaluateRecovery(graph, spec);
  }
  // A bare required pattern name means "an event of this type must exist".
  const ok = graph.ofType(pattern.kind === 'forbidden-type' ? pattern.event : spec).length > 0;
  return {
    pattern: spec,
    kind: 'sequence',
    satisfied: ok,
    ...(ok
      ? {}
      : { reason: reason('REQUIRED_PATTERN_MISSING', `required event not found: ${spec}`) }),
  };
}

/** Evaluate a single forbidden pattern (must NOT hold). */
export function evaluateForbidden(graph: CausalGraph, spec: string): PatternResult {
  const pattern = parsePattern(spec);
  if (pattern.kind === 'forbidden-type') {
    const hits = graph.ofType(pattern.event);
    const violated = hits.length > 0;
    return {
      pattern: spec,
      kind: pattern.kind,
      satisfied: !violated,
      ...(violated
        ? {
            reason: reason(
              'FORBIDDEN_EVENT_PATTERN',
              `forbidden event observed: ${pattern.event}`,
              { count: hits.length },
            ),
          }
        : {}),
    };
  }
  if (pattern.kind === 'without-prior') {
    for (const e of graph.ofType(pattern.event)) {
      const missing = pattern.requiredPriors.filter((pt) => !graph.hasAncestor(e.event_id, pt));
      if (missing.length > 0) {
        return {
          pattern: spec,
          kind: pattern.kind,
          satisfied: false,
          reason: reason(
            'FORBIDDEN_EVENT_PATTERN',
            `${pattern.event} occurred without causally-prior ${missing.join(', ')}`,
            {
              event: e.event_id,
              missing,
            },
          ),
        };
      }
    }
    return { pattern: spec, kind: pattern.kind, satisfied: true };
  }
  // Sequence used as forbidden → violated if the chain exists.
  if (pattern.kind === 'sequence') {
    const exists = existsCausalChain(graph, pattern.types);
    return {
      pattern: spec,
      kind: pattern.kind,
      satisfied: !exists,
      ...(exists
        ? {
            reason: reason(
              'FORBIDDEN_EVENT_PATTERN',
              `forbidden causal sequence occurred: ${spec}`,
            ),
          }
        : {}),
    };
  }
  return evaluateRecovery(graph, spec);
}

/** Evaluate an eventual-recovery obligation. */
export function evaluateRecovery(graph: CausalGraph, spec: string): PatternResult {
  const pattern = parsePattern(spec);
  if (pattern.kind !== 'recovery') {
    return { pattern: spec, kind: 'recovery', satisfied: true };
  }
  for (const e of graph.ofType(pattern.trigger)) {
    if (!graph.hasDescendantType(e.event_id, pattern.satisfiedBy)) {
      return {
        pattern: spec,
        kind: 'recovery',
        satisfied: false,
        reason: reason(
          'RECOVERY_OBLIGATION_UNMET',
          `${pattern.trigger} did not causally lead to ${pattern.satisfiedBy.join(' | ')}`,
          { trigger: e.event_id },
        ),
      };
    }
  }
  return { pattern: spec, kind: 'recovery', satisfied: true };
}

export interface CausalConformance {
  structural: Reason[];
  required: PatternResult[];
  forbidden: PatternResult[];
  recovery: PatternResult[];
  conformant: boolean;
}

/** Full causal conformance evaluation used by the assurance kernel. */
export function evaluateConformance(
  graph: CausalGraph,
  requiredPatterns: string[],
  forbiddenPatterns: string[],
  recoveryObligations: string[] = [],
): CausalConformance {
  const structural = graph.validate();
  const required = requiredPatterns.map((p) => evaluateRequired(graph, p));
  const forbidden = forbiddenPatterns.map((p) => evaluateForbidden(graph, p));
  const recovery = recoveryObligations.map((p) => evaluateRecovery(graph, p));
  const conformant =
    structural.length === 0 &&
    required.every((r) => r.satisfied) &&
    forbidden.every((r) => r.satisfied) &&
    recovery.every((r) => r.satisfied);
  return { structural, required, forbidden, recovery, conformant };
}
