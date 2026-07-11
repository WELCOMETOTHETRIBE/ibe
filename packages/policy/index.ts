/**
 * @ibe/policy — the deterministic Policy Decision Point. External to the
 * builder; returns structured allow/deny decisions with capabilities,
 * conditions, and required approvals. Versioned and hashed for evidence.
 */

export * from './types.js';
export * from './rules.js';
export * from './engine.js';
export * from './opa-adapter.js';
