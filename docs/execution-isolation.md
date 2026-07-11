# Execution Isolation

IBE executes untrusted, AI-proposed code under a capability, inside an ephemeral
workspace, behind a runner abstraction. The platform's honesty rule is central here:
**a certificate never claims isolation it did not actually get.**

Source: `packages/execution/runner.ts`, `docker-runner.ts`, `local-runner.ts`, `workspace.ts`.

## Runner abstraction

`ExecutionRunner` (interface):

| Member | Purpose |
|---|---|
| `name: string` | Runner identity, recorded in the result |
| `available(): boolean` | Whether this runner can actually run here |
| `providesIsolation: boolean` | True **only** for real container isolation |
| `run(req): Promise<ExecutionResult>` | Execute the request |

`ExecutionRequest` fields: `workspaceDir`, `command` + `args` (never a shell string — no
shell-injection surface), `env?` (explicit; host credentials are never inherited),
`timeoutMs`, `cpuLimit?`, `memoryLimitMb?`, `network?` (deny by default), `artifacts?`
(files whose digests are captured).

`ExecutionResult` fields: `runner`, `isolated`, `outcome`, `exitCode`, `stdout`,
`stderr`, `artifactDigests`, `durationMs`.

`ExecutionOutcome` = `'success' | 'failure' | 'timeout' | 'crash' | 'isolation_unavailable'`.

`selectRunner(preferDocker = true)` returns the `DockerRunner` when Docker is available,
otherwise the always-available `LocalProcessRunner`.

## Docker runner (real isolation)

`DockerRunner` (`providesIsolation = true`) checks `docker version` (5s timeout) in
`available()`. When it runs, it invokes `docker run` (via `spawn`, `shell: false`) with
these constraints:

| Constraint | Value |
|---|---|
| Cleanup | `--rm` |
| Network | `--network=none` by default (`--network=bridge` only if `network` requested) |
| Root filesystem | `--read-only` |
| Writable workspace | `--tmpfs /work:rw,exec,size=256m` |
| User | `--user 65534:65534` (nobody — non-root) |
| Memory | `--memory ${memoryLimitMb ?? 256}m` |
| CPU | `--cpus ${cpuLimit ?? 1}` |
| PIDs | `--pids-limit 256` |
| Capabilities | `--cap-drop ALL` |
| Privilege escalation | `--security-opt no-new-privileges` |
| Workspace mount | `-v <workspaceDir>:/work:rw`, `-w /work` |
| Environment | explicit `-e k=v` only (no host credential inheritance) |

Default image: `IBE_RUNNER_IMAGE` or `node:20-alpine`. A wall-clock `setTimeout` sends
`SIGKILL` on timeout. Outcome maps `timedOut → timeout`, `code === 0 → success`, else
`failure`; a spawn error is a `crash`. Artifacts are SHA-256 hashed.

If Docker is unavailable, `run()` returns `outcome: 'isolation_unavailable'`,
`isolated: false`, `stderr: 'Docker is not available in this environment.'` — the kernel
then **fails closed** rather than pretending isolation happened.

## Local runner (honestly-labeled, NOT isolated)

> In the default dev environment Docker is **not installed**, so the local runner is
> used and every generated certificate records `execution_isolated: false` (surfaced in
> the assurance-case assumptions as `"execution runner: local-process (NOT
> container-isolated) (isolated=false)"`).

`LocalProcessRunner` sets `providesIsolation = false`, `available()` always `true`, and
hard-codes `isolated: false` on every result. Its `name` literally embeds the caveat:
`'local-process (NOT container-isolated)'`.

What it **does** provide (its honesty contract):

- **Scrubbed environment** — only `PATH, HOME, LANG, LC_ALL, NODE_OPTIONS, TMPDIR` pass
  through from the host; explicit request env wins; always sets `IBE_SANDBOX=1`. Never
  host secrets.
- **No shell** — `spawn(command, args, { shell: false })` prevents shell injection.
- **Process-group kill on timeout** — `detached: true` plus
  `process.kill(-pid, 'SIGKILL')` kills the whole tree.
- **Output DoS guard** — stdout and stderr are each capped at `MAX_CAPTURE = 2 MiB`.
- **Artifact hashing** and an **exit code / outcome** (`timeout | crash | success | failure`).

What it **does not** provide: container, network, or filesystem isolation. Because the
kernel records `isolated=false`, no certificate can claim container isolation that did
not occur (`assurance/kernel.ts` folds `execution.isolated` into the certificate and the
assurance case).

## Workspace path-safety

`packages/execution/workspace.ts` gives each run a fresh temp directory:

- `createWorkspace(prefix)` uses `IBE_WORKSPACE_ROOT` or `.ibe/workspaces` and
  `mkdtempSync` for a unique dir; `cleanup()` removes it.
- `stageInto(...)` resolves the source with the shared `resolveWithin` helper (keeps the
  path inside `sourceRoot`, defeating path traversal) and copies with
  `cpSync(..., { dereference: false, filter: reject symlinks })` — **symlinks are never
  copied**, defeating symlink-escape during setup.
- `withWorkspace(fn)` guarantees cleanup in a `finally` block even on throw.

The kernel's `causally-valid` gate additionally refuses when the execution outcome is
inconclusive (`timeout`, `crash`, `isolation_unavailable`), so a certificate is never
issued over an unknown run.
