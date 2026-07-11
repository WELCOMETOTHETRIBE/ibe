/**
 * @ibe/model — compact MBSE metamodel + traceability/impact/delta, assume-
 * guarantee composition, and information-flow control. The authoritative model
 * cannot be silently rewritten to match implementation behavior: deltas are
 * explicit, hashed, and drive evidence invalidation.
 */

export * from './entities.js';
export * from './graph.js';
export * from './load.js';
export * from './delta.js';
export * from './assume-guarantee.js';
export * from './dataflow.js';
export * from './sysml-adapter.js';
