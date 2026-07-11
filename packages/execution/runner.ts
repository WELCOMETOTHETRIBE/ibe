/**
 * Execution runner abstraction (§10).
 *
 * The runner executes untrusted proposed code under a capability. There are two
 * implementations:
 *   - DockerRunner: real container isolation (network-none, read-only rootfs,
 *     non-root, cpu/memory/timeout limits). Requires Docker.
 *   - LocalProcessRunner: a child-process fallback for environments without
 *     Docker. It is HONESTLY LABELED `isolated: false` — it provides process
 *     separation and stdio/timeout control but NOT container isolation. The
 *     kernel records this so a certificate never claims isolation it didn't get.
 */

import type { Digest } from '../shared/index.js';

export type ExecutionOutcome =
  | 'success'
  | 'failure'
  | 'timeout'
  | 'crash'
  | 'isolation_unavailable';

export interface ExecutionRequest {
  /** Absolute path to the writable, ephemeral workspace. */
  workspaceDir: string;
  /** Command + args to run (never a shell string — no shell injection surface). */
  command: string;
  args: string[];
  /** Explicit environment. Host credentials are NEVER inherited. */
  env?: Record<string, string>;
  timeoutMs: number;
  cpuLimit?: number;
  memoryLimitMb?: number;
  /** Deny network by default. */
  network?: boolean;
  /** Files (relative to workspace) whose digests should be captured as artifacts. */
  artifacts?: string[];
}

export interface ExecutionResult {
  runner: string;
  isolated: boolean;
  outcome: ExecutionOutcome;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  artifactDigests: Record<string, Digest>;
  durationMs: number;
}

export interface ExecutionRunner {
  readonly name: string;
  /** Whether this runner can actually run in the current environment. */
  available(): boolean;
  /** True only for real isolation (containers). */
  readonly providesIsolation: boolean;
  run(req: ExecutionRequest): Promise<ExecutionResult>;
}
