/**
 * Git change analysis (§11). Parses a unified diff into structured changed-file
 * records (added/modified/deleted/renamed with line deltas) and can drive `git`
 * over a repository fixture. This replaces the original "enumerate the patched
 * directory" heuristic with real change detection.
 */

import { spawnSync } from 'node:child_process';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
  path: string;
  oldPath?: string;
  status: ChangeStatus;
  addedLines: number;
  removedLines: number;
}

/** Parse a unified `git diff` into changed files. Tolerant of rename/new/deleted. */
export function parseUnifiedDiff(diff: string): ChangedFile[] {
  const files: ChangedFile[] = [];
  const lines = diff.split(/\r?\n/);
  let current: ChangedFile | null = null;

  const flush = (): void => {
    if (current) files.push(current);
    current = null;
  };

  for (const line of lines) {
    const gitHeader = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (gitHeader) {
      flush();
      current = {
        path: gitHeader[2] as string,
        status: 'modified',
        addedLines: 0,
        removedLines: 0,
      };
      continue;
    }
    if (!current) continue;

    if (line.startsWith('new file mode')) current.status = 'added';
    else if (line.startsWith('deleted file mode')) current.status = 'deleted';
    else if (line.startsWith('rename from ')) {
      current.oldPath = line.slice('rename from '.length);
      current.status = 'renamed';
    } else if (line.startsWith('rename to ')) {
      current.path = line.slice('rename to '.length);
      current.status = 'renamed';
    } else if (line.startsWith('+++ ') || line.startsWith('--- ')) {
      // file path markers; ignore (already captured from git header)
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      current.addedLines += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      current.removedLines += 1;
    }
  }
  flush();
  return files;
}

/** Run `git diff` in a repository and return the parsed changes. */
export function gitDiff(repoDir: string, from: string, to = ''): ChangedFile[] {
  const args = ['-C', repoDir, 'diff', '--no-color', '-M'];
  if (from) args.push(from);
  if (to) args.push(to);
  const r = spawnSync('git', args, { encoding: 'utf-8', timeout: 20000 });
  if (r.status !== 0) return [];
  return parseUnifiedDiff(r.stdout);
}

/** Read file contents at two git refs, for AST symbol comparison. */
export function gitShow(repoDir: string, ref: string, path: string): string | null {
  const r = spawnSync('git', ['-C', repoDir, 'show', `${ref}:${path}`], {
    encoding: 'utf-8',
    timeout: 20000,
  });
  return r.status === 0 ? r.stdout : null;
}
