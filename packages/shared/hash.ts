/**
 * Content hashing. All digests in IBE are SHA-256 over canonical JSON bytes
 * (for structured data) or raw bytes (for files/artifacts), prefixed with the
 * algorithm so digests are self-describing and future-proof.
 */

import { createHash } from 'node:crypto';
import { canonicalStringify } from './canonical.js';

export type Digest = `sha256:${string}`;

/** Hash raw bytes / string content. */
export function sha256(data: string | Uint8Array): Digest {
  const h = createHash('sha256');
  h.update(data);
  return `sha256:${h.digest('hex')}`;
}

/** Hash a structured value via its canonical JSON representation. */
export function digestOf(value: unknown): Digest {
  return sha256(canonicalStringify(value));
}

/** Constant-time-ish comparison of two digests. */
export function digestEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
