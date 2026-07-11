/**
 * Scope enforcement (§11): compare real git+AST change analysis against the
 * intent's authorized scope and refuse anything outside it. This is where the
 * doctrine "AI-generated code is a proposal, never authority" becomes concrete —
 * the change may not touch files, functions, protected governance code, or
 * dependencies beyond what the intent authorized.
 */

import { Reason, reason } from '../shared/index.js';
import type { IntentContract } from '../intent/index.js';
import type { ChangedFile } from './git.js';
import type { SymbolChange } from './ast.js';

/** Governance code a builder must never modify unless explicitly authorized. */
export const PROTECTED_GLOBS = [
  'packages/policy/**',
  'packages/assurance/**',
  'packages/provenance/**',
  'packages/capabilities/**',
  'policies/**',
  'formal/**',
  '.github/**',
];

/** Files that should never appear as human-authored change (generated output). */
export const UNEXPECTED_GENERATED_GLOBS = ['dist/**', 'evidence/generated/**', 'node_modules/**'];

/** Minimal, anchored glob matcher (supports **, *, ?). */
export function globMatch(glob: string, path: string): boolean {
  const parts = glob.split('**');
  const re = parts
    .map((part) =>
      part
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]'),
    )
    .join('.*');
  return new RegExp(`^${re}$`).test(path);
}

function matchesAny(globs: string[], path: string): boolean {
  return globs.some((g) => globMatch(g, path) || g === path || path.endsWith(g));
}

export interface ScopeAnalysisInput {
  intent: IntentContract;
  changedFiles: ChangedFile[];
  /** Per-file symbol changes (from AST diff), keyed by file path. */
  symbolChanges?: Record<string, SymbolChange[]>;
  /** Dependencies added in this change (name list), if computed from lockfiles. */
  addedDependencies?: string[];
}

export interface ScopeReport {
  authorizedFiles: string[];
  changedFiles: string[];
  outOfScopeFiles: string[];
  outOfScopeFunctions: Array<{ file: string; symbol: string }>;
  protectedPathTouched: string[];
  unexpectedGeneratedFiles: string[];
  unauthorizedDependencies: string[];
  violations: Reason[];
}

export function analyzeScope(input: ScopeAnalysisInput): ScopeReport {
  const { intent, changedFiles } = input;
  const authorizedFiles = intent.scope.files;
  const authorizedFunctions = new Set(intent.scope.functions);
  const branches = intent.scope.branches;

  const violations: Reason[] = [];
  const outOfScopeFiles: string[] = [];
  const outOfScopeFunctions: Array<{ file: string; symbol: string }> = [];
  const protectedPathTouched: string[] = [];
  const unexpectedGeneratedFiles: string[] = [];

  for (const cf of changedFiles) {
    const path = cf.path;

    // Unexpected generated files.
    if (matchesAny(UNEXPECTED_GENERATED_GLOBS, path)) {
      unexpectedGeneratedFiles.push(path);
      violations.push(
        reason('OUT_OF_SCOPE', `unexpected generated/build file changed: ${path}`, { path }),
      );
      continue;
    }

    // Protected governance code — the builder cannot edit what judges it.
    if (matchesAny(PROTECTED_GLOBS, path) && !matchesAny(authorizedFiles, path)) {
      protectedPathTouched.push(path);
      violations.push(
        reason(
          'POLICY_DENIED',
          `change touches protected governance path without authorization: ${path}`,
          { path },
        ),
      );
      continue;
    }

    // File must be within the authorized file set.
    if (authorizedFiles.length > 0 && !matchesAny(authorizedFiles, path)) {
      outOfScopeFiles.push(path);
      violations.push(
        reason('OUT_OF_SCOPE', `changed file "${path}" is outside authorized scope`, {
          path,
          authorized: authorizedFiles,
        }),
      );
      continue;
    }

    // Function-level scope: if the intent named functions, changed symbols must
    // be within that set.
    if (authorizedFunctions.size > 0) {
      const symChanges = input.symbolChanges?.[path] ?? [];
      for (const sc of symChanges) {
        if (!authorizedFunctions.has(sc.name)) {
          outOfScopeFunctions.push({ file: path, symbol: sc.name });
          violations.push(
            reason(
              'OUT_OF_SCOPE',
              `changed symbol "${sc.name}" in ${path} is outside authorized functions`,
              {
                file: path,
                symbol: sc.name,
              },
            ),
          );
        }
      }
    }
  }

  // Dependency additions outside approved scope.
  const unauthorizedDependencies = input.addedDependencies ?? [];
  for (const dep of unauthorizedDependencies) {
    violations.push(
      reason('OUT_OF_SCOPE', `dependency "${dep}" was added but is not authorized by the intent`, {
        dep,
      }),
    );
  }

  // Branch protection note (informational — enforced elsewhere against real git).
  void branches;

  return {
    authorizedFiles,
    changedFiles: changedFiles.map((c) => c.path),
    outOfScopeFiles,
    outOfScopeFunctions,
    protectedPathTouched,
    unexpectedGeneratedFiles,
    unauthorizedDependencies,
    violations,
  };
}
