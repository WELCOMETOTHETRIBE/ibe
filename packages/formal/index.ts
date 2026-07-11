/**
 * @ibe/formal — explicit-state checker mirroring the TLA+ specs for the
 * capability and promotion lifecycles. Runs in CI without a TLC install.
 */

export * from './transition-system.js';
export * from './capability-spec.js';
export * from './promotion-spec.js';
export * from './check.js';
