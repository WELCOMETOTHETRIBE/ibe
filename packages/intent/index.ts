/**
 * @ibe/intent — Intent Contract v2: the machine-checkable binding between a
 * human-declared intent and a proposed change. This is the entry gate of the
 * assurance chain; nothing downstream runs without a valid, unexpired contract.
 */

export * from './contract.js';
export * from './completeness.js';
export * from './load.js';
export * from './migrate.js';
