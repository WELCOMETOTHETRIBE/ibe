/**
 * Model graph: indexing, referential-integrity validation, traceability and
 * impact analysis. This is what lets IBE answer "which verification cases must
 * rerun / which evidence is now stale / which hazards become relevant" when a
 * change touches specific model elements.
 */

import { Reason, reason } from '../shared/index.js';
import type { ModelElementT, SystemModelT, RelationTypeT } from './entities.js';

export interface ImpactResult {
  changed: string[];
  affectedComponents: string[];
  affectedInterfaces: string[];
  trustBoundariesAltered: string[];
  verificationCasesToRerun: string[];
  relevantHazards: string[];
  requirementsTouched: string[];
}

export class ModelGraph {
  readonly model: SystemModelT;
  private readonly byId = new Map<string, ModelElementT>();
  /** reverse[targetId] = [{from, type}] — who points at this element. */
  private readonly reverse = new Map<string, Array<{ from: string; type: RelationTypeT }>>();

  constructor(model: SystemModelT) {
    this.model = model;
    for (const el of model.elements) {
      this.byId.set(el.id, el);
    }
    for (const el of model.elements) {
      for (const rel of el.relationships) {
        const list = this.reverse.get(rel.target) ?? [];
        list.push({ from: el.id, type: rel.type });
        this.reverse.set(rel.target, list);
      }
      // DataFlow from/to are implicit relationships.
      if (el.kind === 'DataFlow') {
        for (const t of [el.from, el.to]) {
          const list = this.reverse.get(t) ?? [];
          list.push({ from: el.id, type: 'carries' });
          this.reverse.set(t, list);
        }
      }
    }
  }

  get(id: string): ModelElementT | undefined {
    return this.byId.get(id);
  }
  has(id: string): boolean {
    return this.byId.has(id);
  }
  ofKind<K extends ModelElementT['kind']>(kind: K): Extract<ModelElementT, { kind: K }>[] {
    return this.model.elements.filter((e) => e.kind === kind) as Extract<
      ModelElementT,
      { kind: K }
    >[];
  }

  /** Referential integrity: every relationship/dataflow target must exist. */
  validate(): Reason[] {
    const errors: Reason[] = [];
    const seen = new Set<string>();
    for (const el of this.model.elements) {
      if (seen.has(el.id)) {
        errors.push(reason('MODEL_INVALID', `duplicate element id ${el.id}`, { id: el.id }));
      }
      seen.add(el.id);
      for (const rel of el.relationships) {
        if (!this.byId.has(rel.target)) {
          errors.push(
            reason('MODEL_UNTRACEABLE', `${el.id} --${rel.type}--> missing target ${rel.target}`, {
              from: el.id,
              type: rel.type,
              target: rel.target,
            }),
          );
        }
      }
      if (el.kind === 'DataFlow') {
        for (const t of [el.from, el.to]) {
          if (!this.byId.has(t)) {
            errors.push(
              reason('MODEL_UNTRACEABLE', `DataFlow ${el.id} references missing endpoint ${t}`),
            );
          }
        }
      }
    }
    return errors;
  }

  /** Elements that directly or transitively point at any of `ids` (reverse BFS). */
  private reverseClosure(ids: string[]): Set<string> {
    const out = new Set<string>(ids);
    const queue = [...ids];
    while (queue.length > 0) {
      const cur = queue.shift() as string;
      for (const { from } of this.reverse.get(cur) ?? []) {
        if (!out.has(from)) {
          out.add(from);
          queue.push(from);
        }
      }
    }
    return out;
  }

  /** Traceability: requirements a change to `elementIds` touches. */
  requirementsFor(elementIds: string[]): string[] {
    const closure = this.reverseClosure(elementIds);
    return this.ofKind('Requirement')
      .filter(
        (r) => closure.has(r.id) || r.relationships.some((rel) => elementIds.includes(rel.target)),
      )
      .map((r) => r.id);
  }

  /**
   * Full impact analysis for a set of changed model element ids.
   */
  impactOf(changedElementIds: string[]): ImpactResult {
    const changed = changedElementIds.filter((id) => this.byId.has(id));
    const closure = this.reverseClosure(changed);

    const affectedComponents = [...closure].filter((id) => this.byId.get(id)?.kind === 'Component');
    const affectedInterfaces = [...closure].filter((id) => this.byId.get(id)?.kind === 'Interface');

    // Trust boundaries altered: any boundary enclosing a changed/affected element,
    // any changed interface flipping public, or a changed dataflow that crosses one.
    const trustBoundariesAltered = this.ofKind('TrustBoundary')
      .filter(
        (tb) =>
          tb.encloses.some((e) => closure.has(e)) ||
          changed.includes(tb.id) ||
          this.ofKind('DataFlow').some(
            (df) =>
              changed.includes(df.id) &&
              df.relationships.some((r) => r.type === 'crosses' && r.target === tb.id),
          ),
      )
      .map((tb) => tb.id);

    // Verification cases whose `verifies` target is in the impact closure.
    const verificationCasesToRerun = this.ofKind('VerificationCase')
      .filter((vc) => vc.relationships.some((r) => r.type === 'verifies' && closure.has(r.target)))
      .map((vc) => vc.id);

    // Hazards relevant: hazards mitigated by an invariant constraining an affected
    // component, or hazards directly referencing a changed element.
    const affectedInvariants = this.ofKind('Invariant')
      .filter((inv) =>
        inv.relationships.some((r) => r.type === 'constrains' && closure.has(r.target)),
      )
      .map((inv) => inv.id);
    const relevantHazards = this.ofKind('Hazard')
      .filter(
        (h) =>
          h.relationships.some(
            (r) => r.type === 'mitigatedBy' && affectedInvariants.includes(r.target),
          ) || h.relationships.some((r) => closure.has(r.target)),
      )
      .map((h) => h.id);

    return {
      changed,
      affectedComponents,
      affectedInterfaces,
      trustBoundariesAltered,
      verificationCasesToRerun,
      relevantHazards,
      requirementsTouched: this.requirementsFor(changed),
    };
  }
}
