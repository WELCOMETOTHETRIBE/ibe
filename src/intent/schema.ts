/**
 * Intent schema type definitions for Intent-Bound Execution.
 * All types are strict and enforce machine-checkability.
 */

export type AllowedVerb = 'ensure' | 'prevent' | 'maintain' | 'enforce' | 'guarantee' | 'preserve';

export type RiskTolerance = 'strict' | 'moderate' | 'permissive';

export type MetricOperator = 'lt' | 'le' | 'eq' | 'ge' | 'gt' | 'ne';

export type TestInputAction = 'allow' | 'getRemaining';

export interface TestInput {
  action: TestInputAction;
  key: string;
  timestamp_ms?: number;
}

export interface Invariant {
  name: string;
  metric_path: string;
  operator: MetricOperator;
  threshold: number;
}

export interface Scope {
  files: string[];
  functions: string[];
  exclusions?: string[];
}

export interface Intent {
  goal: string;
  scope: Scope;
  invariants: Invariant[];
  risk_tolerance: RiskTolerance;
  test_inputs: TestInput[];
}

/**
 * Available metric paths that can be checked.
 * This is the exact set - no others are allowed.
 */
export const AVAILABLE_METRICS = [
  'allow_count',
  'deny_count',
  'token_count',
  'key_count',
  'memory_bytes'
] as const;

export type AvailableMetric = typeof AVAILABLE_METRICS[number];

/**
 * Forbidden words that make a goal vague.
 */
export const FORBIDDEN_VAGUE_WORDS = [
  'improve',
  'better',
  'optimize',
  'enhance',
  'fix',
  'refactor',
  'clean',
  'update',
  'modernize',
  'simplify',
  'good',
  'bad',
  'nice',
  'elegant',
  'readable',
  'maintainable'
] as const;

/**
 * Measurable outcome keywords that must appear in goals.
 */
export const MEASURABLE_OUTCOMES = [
  'capacity',
  'count',
  'rate',
  'limit',
  'threshold',
  'size',
  'bytes',
  'memory',
  'allow',
  'deny',
  'enabled',
  'disabled',
  'active',
  'inactive',
  'seconds',
  'milliseconds',
  'duration',
  'interval'
] as const;

/**
 * Ambiguous words that require clarification.
 */
export const AMBIGUOUS_WORDS = [
  'performance',
  'efficiency',
  'quality'
] as const;

