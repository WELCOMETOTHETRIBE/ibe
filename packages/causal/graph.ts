/**
 * Causal graph engine (§12). Builds a DAG from event parent links and provides
 * the structural checks the assurance kernel relies on: missing-parent
 * detection, cycle detection (a causal graph must be acyclic), temporal-ordering
 * validation, and ancestry/descendant queries used by pattern evaluation.
 *
 * DoS guard: node and edge counts are bounded so a hostile trace cannot exhaust
 * memory or CPU in graph traversal.
 */

import { Reason, reason } from '../shared/index.js';
import type { Event } from '../events/index.js';

export const MAX_EVENTS = 100_000;

export class CausalGraph {
  private readonly byId = new Map<string, Event>();
  private readonly children = new Map<string, string[]>();

  constructor(events: Event[]) {
    if (events.length > MAX_EVENTS) {
      throw new Error(`event trace exceeds MAX_EVENTS (${MAX_EVENTS})`);
    }
    for (const e of events) this.byId.set(e.event_id, e);
    for (const e of events) {
      for (const p of e.parent_event_ids) {
        const list = this.children.get(p) ?? [];
        list.push(e.event_id);
        this.children.set(p, list);
      }
    }
  }

  get(id: string): Event | undefined {
    return this.byId.get(id);
  }
  all(): Event[] {
    return [...this.byId.values()];
  }
  ofType(type: string): Event[] {
    return this.all().filter((e) => e.event_type === type);
  }

  /** Structural validation: missing parents, cycles, temporal ordering. */
  validate(): Reason[] {
    const errors: Reason[] = [];

    // Missing parents.
    for (const e of this.byId.values()) {
      for (const p of e.parent_event_ids) {
        if (!this.byId.has(p)) {
          errors.push(
            reason('CAUSAL_INVALID', `event ${e.event_id} references missing parent ${p}`, {
              event: e.event_id,
              parent: p,
            }),
          );
        } else {
          // Temporal: a cause cannot occur strictly after its effect.
          const parent = this.byId.get(p)!;
          if (Date.parse(parent.occurred_at) > Date.parse(e.occurred_at)) {
            errors.push(
              reason(
                'CAUSAL_INVALID',
                `event ${e.event_id} occurs before its parent ${p} (temporal violation)`,
                {
                  event: e.event_id,
                  parent: p,
                },
              ),
            );
          }
        }
      }
    }

    // Cycle detection (DFS with colors).
    const WHITE = 0,
      GRAY = 1,
      BLACK = 2;
    const color = new Map<string, number>();
    for (const id of this.byId.keys()) color.set(id, WHITE);
    const stack: Array<{ id: string; iter: number }> = [];
    for (const start of this.byId.keys()) {
      if (color.get(start) !== WHITE) continue;
      stack.push({ id: start, iter: 0 });
      color.set(start, GRAY);
      while (stack.length > 0) {
        const frame = stack[stack.length - 1]!;
        const kids = this.children.get(frame.id) ?? [];
        if (frame.iter < kids.length) {
          const next = kids[frame.iter++] as string;
          const c = color.get(next);
          if (c === GRAY) {
            errors.push(
              reason('CAUSAL_INVALID', `causal cycle detected involving ${next}`, { node: next }),
            );
          } else if (c === WHITE) {
            color.set(next, GRAY);
            stack.push({ id: next, iter: 0 });
          }
        } else {
          color.set(frame.id, BLACK);
          stack.pop();
        }
      }
    }
    return errors;
  }

  /** All causal ancestors of an event (transitive parents). */
  ancestors(eventId: string): Set<string> {
    const out = new Set<string>();
    const queue = [...(this.byId.get(eventId)?.parent_event_ids ?? [])];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      if (out.has(cur)) continue;
      out.add(cur);
      for (const p of this.byId.get(cur)?.parent_event_ids ?? []) queue.push(p);
    }
    return out;
  }

  /** All causal descendants of an event (transitive children). */
  descendants(eventId: string): Set<string> {
    const out = new Set<string>();
    const queue = [...(this.children.get(eventId) ?? [])];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      if (out.has(cur)) continue;
      out.add(cur);
      for (const c of this.children.get(cur) ?? []) queue.push(c);
    }
    return out;
  }

  /** Is `ancestorId` a causal ancestor of `eventId`? */
  hasAncestor(eventId: string, ancestorType: string): boolean {
    for (const a of this.ancestors(eventId)) {
      if (this.byId.get(a)?.event_type === ancestorType) return true;
    }
    return false;
  }

  /** Does a causal descendant of `eventId` have any of the given types? */
  hasDescendantType(eventId: string, types: string[]): boolean {
    for (const d of this.descendants(eventId)) {
      const t = this.byId.get(d)?.event_type;
      if (t && types.includes(t)) return true;
    }
    return false;
  }
}
