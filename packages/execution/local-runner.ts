/**
 * LocalProcessRunner — child-process execution fallback.
 *
 * IMPORTANT HONESTY CONTRACT: this runner reports `isolated: false`. It provides
 * process separation, a scrubbed environment (no inherited host credentials),
 * captured stdout/stderr, an exit code, artifact hashing, and a hard timeout
 * with process-tree kill. It does NOT provide container/network/filesystem
 * isolation. The assurance kernel records `isolated=false` so no certificate can
 * claim container isolation that did not occur.
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, type Digest } from '../shared/index.js';
import type { ExecutionRequest, ExecutionResult, ExecutionRunner } from './runner.js';

/** Environment variables that are safe to pass through; everything else is dropped. */
const SAFE_PASSTHROUGH = new Set(['PATH', 'HOME', 'LANG', 'LC_ALL', 'NODE_OPTIONS', 'TMPDIR']);

function scrubbedEnv(extra?: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {};
  for (const key of SAFE_PASSTHROUGH) {
    const v = process.env[key];
    if (v !== undefined) base[key] = v;
  }
  // Explicit request env wins, but never secrets from the host.
  return { ...base, ...(extra ?? {}), IBE_SANDBOX: '1' };
}

export class LocalProcessRunner implements ExecutionRunner {
  readonly name = 'local-process (NOT container-isolated)';
  readonly providesIsolation = false;

  available(): boolean {
    return true;
  }

  run(req: ExecutionRequest): Promise<ExecutionResult> {
    const start = Date.now();
    return new Promise<ExecutionResult>((resolvePromise) => {
      const child = spawn(req.command, req.args, {
        cwd: req.workspaceDir,
        env: scrubbedEnv(req.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        // Never run through a shell — prevents shell injection via args.
        shell: false,
        detached: true,
      });

      let stdout = '';
      let stderr = '';
      let killedByTimeout = false;
      const MAX_CAPTURE = 2 * 1024 * 1024; // cap captured output (DoS guard)

      child.stdout?.on('data', (d) => {
        if (stdout.length < MAX_CAPTURE) stdout += d.toString();
      });
      child.stderr?.on('data', (d) => {
        if (stderr.length < MAX_CAPTURE) stderr += d.toString();
      });

      const timer = setTimeout(() => {
        killedByTimeout = true;
        try {
          // Kill the whole process group.
          if (child.pid) process.kill(-child.pid, 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
      }, req.timeoutMs);

      const finish = (exitCode: number | null, crashed: boolean): void => {
        clearTimeout(timer);
        const artifactDigests: Record<string, Digest> = {};
        for (const rel of req.artifacts ?? []) {
          const p = join(req.workspaceDir, rel);
          if (existsSync(p)) {
            try {
              artifactDigests[rel] = sha256(readFileSync(p));
            } catch {
              /* ignore unreadable artifact */
            }
          }
        }
        let outcome: ExecutionResult['outcome'];
        if (killedByTimeout) outcome = 'timeout';
        else if (crashed) outcome = 'crash';
        else outcome = exitCode === 0 ? 'success' : 'failure';

        resolvePromise({
          runner: this.name,
          isolated: false,
          outcome,
          exitCode,
          stdout,
          stderr,
          artifactDigests,
          durationMs: Date.now() - start,
        });
      };

      child.on('error', (e) => {
        stderr += `\nspawn error: ${e.message}`;
        finish(null, true);
      });
      child.on('close', (code) => finish(code, false));
    });
  }
}
