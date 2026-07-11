/**
 * Model delta generation. Comparing a baseline model version against a proposed
 * one yields the set of added/removed/modified elements and a stable delta hash
 * that is bound into capabilities and certificates. Evidence collected against a
 * superseded delta hash is automatically stale (see provenance/freshness).
 */

import { digestOf, type Digest } from '../shared/index.js';
import type { ModelGraph } from './graph.js';
import type { ModelElementT } from './entities.js';

export interface ModifiedElement {
  id: string;
  changedFields: string[];
  beforeHash: Digest;
  afterHash: Digest;
}

export interface ModelDelta {
  baseVersion: string;
  proposedVersion: string;
  added: string[];
  removed: string[];
  modified: ModifiedElement[];
  /** All element ids touched — feeds impact analysis. */
  changedElementIds: string[];
  deltaHash: Digest;
}

function changedFields(a: ModelElementT, b: ModelElementT): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: string[] = [];
  for (const k of keys) {
    const av = (a as Record<string, unknown>)[k];
    const bv = (b as Record<string, unknown>)[k];
    if (digestOf(av ?? null) !== digestOf(bv ?? null)) out.push(k);
  }
  return out.sort();
}

export function computeModelDelta(base: ModelGraph, proposed: ModelGraph): ModelDelta {
  const baseIds = new Set(base.model.elements.map((e) => e.id));
  const propIds = new Set(proposed.model.elements.map((e) => e.id));

  const added = [...propIds].filter((id) => !baseIds.has(id)).sort();
  const removed = [...baseIds].filter((id) => !propIds.has(id)).sort();

  const modified: ModifiedElement[] = [];
  for (const id of [...propIds].filter((i) => baseIds.has(i)).sort()) {
    const a = base.get(id)!;
    const b = proposed.get(id)!;
    const ah = digestOf(a);
    const bh = digestOf(b);
    if (ah !== bh) {
      modified.push({ id, changedFields: changedFields(a, b), beforeHash: ah, afterHash: bh });
    }
  }

  const changedElementIds = [
    ...new Set([...added, ...removed, ...modified.map((m) => m.id)]),
  ].sort();
  const payload = {
    baseVersion: base.model.model_version,
    proposedVersion: proposed.model.model_version,
    added,
    removed,
    modified: modified.map((m) => ({
      id: m.id,
      changedFields: m.changedFields,
      afterHash: m.afterHash,
    })),
  };

  return {
    baseVersion: base.model.model_version,
    proposedVersion: proposed.model.model_version,
    added,
    removed,
    modified,
    changedElementIds,
    deltaHash: digestOf(payload),
  };
}
