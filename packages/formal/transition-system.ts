/**
 * A tiny explicit-state model checker (BFS over reachable states).
 *
 * The authoritative formal artifacts are the TLA+ specs under /formal/tla. This
 * TypeScript checker mirrors the SAME state machines and invariants so that
 * `npm run formal` provides a deterministic CI gate WITHOUT requiring a TLC/Java
 * download. It checks state (safety) invariants over all reachable states and
 * terminal-state invariants (a bounded stand-in for the "eventually" recovery
 * liveness property) on states that have no successors.
 */

export interface Invariant<S> {
  name: string;
  holds(state: S): boolean;
}

export interface TransitionSystem<S> {
  name: string;
  initial: S[];
  next(state: S): S[];
  key(state: S): string;
  invariants: Invariant<S>[];
  /** Checked only on terminal states (no successors) — recovery/liveness proxy. */
  terminalInvariants?: Invariant<S>[];
}

export interface ModelCheckResult {
  model: string;
  statesExplored: number;
  ok: boolean;
  violations: Array<{ invariant: string; state: unknown; kind: 'safety' | 'terminal' }>;
}

export function checkModel<S>(ts: TransitionSystem<S>, maxStates = 100_000): ModelCheckResult {
  const seen = new Set<string>();
  const queue: S[] = [];
  const violations: ModelCheckResult['violations'] = [];

  for (const s of ts.initial) {
    const k = ts.key(s);
    if (!seen.has(k)) {
      seen.add(k);
      queue.push(s);
    }
  }

  let explored = 0;
  while (queue.length > 0) {
    if (explored > maxStates) break;
    const state = queue.shift() as S;
    explored += 1;

    for (const inv of ts.invariants) {
      if (!inv.holds(state)) {
        violations.push({ invariant: inv.name, state, kind: 'safety' });
      }
    }

    const successors = ts.next(state);
    if (successors.length === 0 && ts.terminalInvariants) {
      for (const inv of ts.terminalInvariants) {
        if (!inv.holds(state)) {
          violations.push({ invariant: inv.name, state, kind: 'terminal' });
        }
      }
    }
    for (const s of successors) {
      const k = ts.key(s);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(s);
      }
    }
  }

  return { model: ts.name, statesExplored: explored, ok: violations.length === 0, violations };
}
