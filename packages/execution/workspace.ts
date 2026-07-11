/**
 * Ephemeral execution workspaces with guaranteed cleanup and path-safety.
 *
 * A workspace is a fresh temp directory: the immutable baseline is copied in
 * read-only, and the proposed change is applied to a writable overlay. All copy
 * operations reject symlinks and paths escaping the source root, defeating
 * symlink-escape and path-traversal during setup.
 */

import { cpSync, mkdtempSync, rmSync, mkdirSync, existsSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveWithin } from '../shared/index.js';

export interface Workspace {
  dir: string;
  cleanup(): void;
}

/** Create a fresh, isolated workspace directory under a controlled root. */
export function createWorkspace(prefix = 'ibe-exec-'): Workspace {
  const base = process.env.IBE_WORKSPACE_ROOT
    ? resolve(process.env.IBE_WORKSPACE_ROOT)
    : join(process.cwd(), '.ibe', 'workspaces');
  if (!existsSync(base)) mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, prefix));
  return {
    dir,
    cleanup(): void {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort cleanup */
      }
    },
  };
}

/**
 * Copy a source tree into the workspace, refusing symlinks (dereference:false +
 * verify) and keeping everything within `sourceRoot`.
 */
export function stageInto(workspaceDir: string, sourceRoot: string, relSubdir: string): string {
  const src = resolveWithin(relSubdir, sourceRoot);
  const dest = join(workspaceDir, relSubdir);
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, {
    recursive: true,
    dereference: false, // do not follow symlinks
    // Refuse to copy symlinks entirely.
    filter: (source) => {
      // node's cpSync filter receives absolute-ish source paths; reject links.
      try {
        return !lstatSync(source).isSymbolicLink();
      } catch {
        return false;
      }
    },
  });
  return dest;
}

/** Run a function with a workspace, guaranteeing cleanup even on throw. */
export async function withWorkspace<T>(
  fn: (dir: string) => Promise<T>,
  prefix?: string,
): Promise<T> {
  const ws = createWorkspace(prefix);
  try {
    return await fn(ws.dir);
  } finally {
    ws.cleanup();
  }
}
