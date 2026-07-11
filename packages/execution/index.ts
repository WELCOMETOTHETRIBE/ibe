/**
 * @ibe/execution — trusted execution abstraction. Real Docker isolation when
 * available; an honestly-labeled non-isolated local fallback otherwise. The
 * kernel records which one ran so certificates never overstate isolation.
 */

export * from './runner.js';
export * from './workspace.js';
export * from './local-runner.js';
export * from './docker-runner.js';
