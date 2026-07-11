/**
 * TypeScript AST symbol analysis via the TypeScript Compiler API (ts-morph).
 *
 * This replaces regex "function name" scraping (which the original validator
 * used and which the spec explicitly forbids as the primary parser) with a real
 * parse. It enumerates top-level functions, classes, and methods, and — given a
 * before/after pair — determines exactly which named symbols changed, so scope
 * enforcement can operate at function granularity.
 */

import { Project, SyntaxKind, type SourceFile } from 'ts-morph';

export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'method';
  /** Canonical text of the symbol body, used for change detection. */
  text: string;
}

function makeProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: true },
  });
}

function collectSymbols(sf: SourceFile): SymbolInfo[] {
  const out: SymbolInfo[] = [];
  for (const fn of sf.getFunctions()) {
    const name = fn.getName();
    if (name) out.push({ name, kind: 'function', text: fn.getText() });
  }
  for (const cls of sf.getClasses()) {
    const cname = cls.getName();
    if (cname) out.push({ name: cname, kind: 'class', text: cls.getText() });
    for (const m of cls.getMethods()) {
      out.push({ name: m.getName(), kind: 'method', text: m.getText() });
    }
  }
  // Arrow functions / function expressions assigned to a named const.
  for (const v of sf.getVariableDeclarations()) {
    const init = v.getInitializer();
    if (
      init &&
      (init.getKind() === SyntaxKind.ArrowFunction ||
        init.getKind() === SyntaxKind.FunctionExpression)
    ) {
      out.push({ name: v.getName(), kind: 'function', text: init.getText() });
    }
  }
  return out;
}

/** Enumerate the named symbols declared in a TypeScript/JavaScript source. */
export function extractSymbols(content: string, fileName = 'file.ts'): SymbolInfo[] {
  const project = makeProject();
  const sf = project.createSourceFile(fileName, content, { overwrite: true });
  return collectSymbols(sf);
}

export interface SymbolChange {
  name: string;
  kind: SymbolInfo['kind'];
  change: 'added' | 'removed' | 'modified';
}

/** Diff two versions of a source file at symbol granularity. */
export function changedSymbols(
  before: string,
  after: string,
  fileName = 'file.ts',
): SymbolChange[] {
  const b = new Map(extractSymbols(before, fileName).map((s) => [`${s.kind}:${s.name}`, s]));
  const a = new Map(extractSymbols(after, fileName).map((s) => [`${s.kind}:${s.name}`, s]));
  const changes: SymbolChange[] = [];
  for (const [key, sym] of a) {
    const prior = b.get(key);
    if (!prior) changes.push({ name: sym.name, kind: sym.kind, change: 'added' });
    else if (prior.text !== sym.text)
      changes.push({ name: sym.name, kind: sym.kind, change: 'modified' });
  }
  for (const [key, sym] of b) {
    if (!a.has(key)) changes.push({ name: sym.name, kind: sym.kind, change: 'removed' });
  }
  return changes;
}
