/**
 * DockerRunner — real container isolation (§10).
 *
 * Runs the command in an ephemeral container with:
 *   --rm                      guaranteed cleanup
 *   --network none            no network by default
 *   --read-only               read-only rootfs
 *   --tmpfs /work:...         writable workspace only
 *   --user 65534:65534        non-root (nobody)
 *   --memory / --cpus         resource limits
 *   --pids-limit / --cap-drop ALL / --security-opt no-new-privileges
 *   -e (explicit only)        no host credential inheritance
 * plus a wall-clock timeout enforced by the parent.
 *
 * If Docker is not installed, `available()` is false and `run()` returns an
 * `isolation_unavailable` outcome — the kernel then fails closed rather than
 * pretending isolation happened.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sha256, type Digest } from '../shared/index.js';
import type { ExecutionRequest, ExecutionResult, ExecutionRunner } from './runner.js';

export interface DockerRunnerOptions {
  image?: string;
}

export class DockerRunner implements ExecutionRunner {
  readonly name = 'docker';
  readonly providesIsolation = true;
  private readonly image: string;

  constructor(opts: DockerRunnerOptions = {}) {
    this.image = opts.image ?? process.env.IBE_RUNNER_IMAGE ?? 'node:20-alpine';
  }

  available(): boolean {
    const r = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return r.status === 0;
  }

  run(req: ExecutionRequest): Promise<ExecutionResult> {
    const start = Date.now();
    if (!this.available()) {
      return Promise.resolve({
        runner: this.name,
        isolated: false,
        outcome: 'isolation_unavailable',
        exitCode: null,
        stdout: '',
        stderr: 'Docker is not available in this environment.',
        artifactDigests: {},
        durationMs: Date.now() - start,
      });
    }

    const dockerArgs = [
      'run',
      '--rm',
      req.network ? '--network=bridge' : '--network=none',
      '--read-only',
      '--tmpfs',
      '/work:rw,exec,size=256m',
      '--user',
      '65534:65534',
      '--memory',
      `${req.memoryLimitMb ?? 256}m`,
      '--cpus',
      `${req.cpuLimit ?? 1}`,
      '--pids-limit',
      '256',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '-v',
      `${req.workspaceDir}:/work:rw`,
      '-w',
      '/work',
    ];
    for (const [k, v] of Object.entries(req.env ?? {})) {
      dockerArgs.push('-e', `${k}=${v}`);
    }
    dockerArgs.push(this.image, req.command, ...req.args);

    return new Promise<ExecutionResult>((resolvePromise) => {
      const child = spawn('docker', dockerArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, req.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        const artifactDigests: Record<string, Digest> = {};
        for (const rel of req.artifacts ?? []) {
          const p = join(req.workspaceDir, rel);
          if (existsSync(p)) {
            try {
              artifactDigests[rel] = sha256(readFileSync(p));
            } catch {
              /* ignore */
            }
          }
        }
        resolvePromise({
          runner: this.name,
          isolated: true,
          outcome: timedOut ? 'timeout' : code === 0 ? 'success' : 'failure',
          exitCode: code,
          stdout,
          stderr,
          artifactDigests,
          durationMs: Date.now() - start,
        });
      });
      child.on('error', (e) => {
        clearTimeout(timer);
        resolvePromise({
          runner: this.name,
          isolated: false,
          outcome: 'crash',
          exitCode: null,
          stdout,
          stderr: `${stderr}\n${e.message}`,
          artifactDigests: {},
          durationMs: Date.now() - start,
        });
      });
    });
  }
}

/** Select the best available runner: Docker if present, else the labeled local fallback. */
export function selectRunner(preferDocker = true): ExecutionRunner {
  if (preferDocker) {
    const docker = new DockerRunner();
    if (docker.available()) return docker;
  }
  // Lazy import to avoid a cycle; local runner is always available.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return new LocalProcessRunnerRef();
}

// Local import placed at bottom to keep the module graph simple.
import { LocalProcessRunner as LocalProcessRunnerRef } from './local-runner.js';
