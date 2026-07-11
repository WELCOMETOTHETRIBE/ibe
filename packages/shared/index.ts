/**
 * @ibe/shared — cross-cutting primitives used by every assurance-kernel module.
 * Trust boundary note: this package contains NO policy or authority logic. It is
 * pure, deterministic plumbing (hashing, canonicalization, IO defenses, clock).
 */

export * from './canonical.js';
export * from './hash.js';
export * from './result.js';
export * from './errors.js';
export * from './clock.js';
export * from './ids.js';
export * from './logging.js';
export * from './fs-safe.js';
