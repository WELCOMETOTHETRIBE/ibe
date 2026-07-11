/**
 * Canonical JSON serialization.
 *
 * Produces a deterministic byte representation of a JSON value by recursively
 * sorting object keys. This is the single source of truth for hashing and
 * signing: two structurally-equal values MUST serialize to identical bytes so
 * that digests and signatures are stable and verifiable across processes.
 *
 * Security note: canonicalization strips `undefined` and rejects non-finite
 * numbers and functions. It is intentionally conservative — anything it cannot
 * represent unambiguously is an error, never a silent coercion.
 */

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

function assertFiniteNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError(`Cannot canonicalize non-finite number: ${value}`);
  }
}

/**
 * Recursively produce a canonical (stable-key-ordered) clone of a JSON value.
 * Throws on values that cannot be represented deterministically.
 */
export function canonicalize(value: unknown): JsonValue {
  if (value === null) return null;

  const t = typeof value;
  if (t === 'boolean' || t === 'string') return value as JsonValue;
  if (t === 'number') {
    assertFiniteNumber(value as number);
    return value as number;
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new CanonicalizationError(`Cannot canonicalize value of type ${t}`);
  }

  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : canonicalize(v)));
  }

  // Plain object. Reject class instances that are not plain records to avoid
  // accidentally hashing prototype-bearing objects (prototype-pollution guard).
  const obj = value as Record<string, unknown>;
  const out: { [key: string]: JsonValue } = {};
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    // Never serialize dangerous keys, defeating prototype-pollution vectors.
    .filter((k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype')
    .sort();
  for (const key of keys) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

/**
 * Deterministic JSON string. Stable across processes and Node versions.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
