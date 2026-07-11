/**
 * Hardened filesystem and structured-input loading.
 *
 * Every intent file, model file, policy bundle, event trace, and evidence
 * object is UNTRUSTED input. This module centralizes the defenses:
 *   - path traversal / absolute-path escape are rejected against an allowed root
 *   - symlinks are refused (lstat, not stat) to prevent symlink escape
 *   - oversized inputs are refused before parsing (DoS guard)
 *   - YAML is parsed with a bounded alias count to defeat "billion laughs"
 *   - prototype-polluting keys (__proto__, constructor, prototype) are stripped
 */

import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, resolve, relative, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { IbeError } from './errors.js';

/** 5 MiB default cap on any single structured input file. */
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export interface SafeReadOptions {
  /** Directory the path must resolve within (defaults to process.cwd()). */
  root?: string;
  maxBytes?: number;
  /** Allow following symlinks (default false — refuses them). */
  allowSymlinks?: boolean;
}

/**
 * Resolve `candidate` and confirm it stays within `root`. Returns the resolved
 * absolute path or throws MALFORMED_INPUT.
 */
export function resolveWithin(candidate: string, root: string): string {
  const resolvedRoot = resolve(root);
  const resolved = isAbsolute(candidate) ? resolve(candidate) : resolve(resolvedRoot, candidate);
  const rel = relative(resolvedRoot, resolved);
  if (rel === '') return resolved;
  if (rel.startsWith('..') || rel.split(sep).includes('..') || isAbsolute(rel)) {
    throw new IbeError('MALFORMED_INPUT', `Path escapes allowed root: ${candidate}`, {
      root: resolvedRoot,
    });
  }
  return resolved;
}

/** Read a UTF-8 text file with all untrusted-input defenses applied.
 *
 * Containment against a root is enforced ONLY when `opts.root` is explicitly
 * provided (used when resolving paths referenced *inside* untrusted files). For
 * a bare top-level CLI argument (no root), the path is honored as given while
 * symlink/size/prototype defenses still apply. */
export function readTextFileSafe(path: string, opts: SafeReadOptions = {}): string {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const resolved = opts.root ? resolveWithin(path, opts.root) : resolve(path);

  let stat;
  try {
    stat = lstatSync(resolved);
  } catch {
    throw new IbeError('MALFORMED_INPUT', `File not found or unreadable: ${path}`);
  }

  if (stat.isSymbolicLink() && !opts.allowSymlinks) {
    throw new IbeError('MALFORMED_INPUT', `Refusing to read symlink (escape guard): ${path}`);
  }
  if (opts.allowSymlinks && stat.isSymbolicLink() && opts.root) {
    // Even when allowed, the symlink target must remain within an explicit root.
    resolveWithin(realpathSync(resolved), opts.root);
  }
  if (!stat.isFile()) {
    throw new IbeError('MALFORMED_INPUT', `Not a regular file: ${path}`);
  }
  if (stat.size > maxBytes) {
    throw new IbeError('INPUT_TOO_LARGE', `File exceeds ${maxBytes} bytes: ${path}`, {
      size: stat.size,
    });
  }
  return readFileSync(resolved, 'utf-8');
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Recursively strip prototype-polluting keys from a parsed structure. */
export function stripDangerousKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripDangerousKeys(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = stripDangerousKeys(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Parse JSON or YAML by content-sniffing the file extension. YAML aliases are
 * bounded to defeat expansion bombs.
 */
export function parseStructured(text: string, path: string): unknown {
  const lower = path.toLowerCase();
  let parsed: unknown;
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) {
    parsed = parseYaml(text, { maxAliasCount: 100, prettyErrors: true });
  } else if (lower.endsWith('.json')) {
    parsed = JSON.parse(text);
  } else {
    // Attempt JSON first, then YAML — both bounded.
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = parseYaml(text, { maxAliasCount: 100 });
    }
  }
  return stripDangerousKeys(parsed);
}

/** Load and parse a structured (JSON/YAML) file with full defenses. */
export function loadStructuredFile(path: string, opts: SafeReadOptions = {}): unknown {
  const text = readTextFileSafe(path, opts);
  return parseStructured(text, path);
}
