/**
 * Stable, prefixed identifiers.
 *
 * IDs are either caller-supplied (from intent/model files) or generated. When
 * generated, they are deterministic given a seed counter so that runs are
 * reproducible under test. Cryptographic randomness is used only for values
 * that must be unguessable (capability nonces), never for correlation IDs.
 */

import { randomBytes } from 'node:crypto';

const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

/** Validate an externally-supplied identifier. Fail-closed on anything odd. */
export function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function assertValidId(id: unknown, kind = 'id'): string {
  if (!isValidId(id)) {
    throw new Error(`Invalid ${kind}: ${JSON.stringify(id)} (must match ${ID_PATTERN})`);
  }
  return id;
}

/** Monotonic, deterministic ID generator for reproducible runs. */
export class SequentialIdGenerator {
  private counter = 0;
  constructor(private readonly prefix: string) {}
  next(): string {
    this.counter += 1;
    return `${this.prefix}-${this.counter.toString().padStart(6, '0')}`;
  }
  reset(): void {
    this.counter = 0;
  }
}

/** Cryptographically-random nonce (hex). Use for capability single-use tokens. */
export function nonce(bytes = 16): string {
  return randomBytes(bytes).toString('hex');
}
