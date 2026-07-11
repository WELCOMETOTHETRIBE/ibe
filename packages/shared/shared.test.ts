import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalStringify,
  digestOf,
  digestEquals,
  parseStructured,
  stripDangerousKeys,
  readTextFileSafe,
  FixedClock,
} from './index.js';

test('canonical JSON is stable regardless of key order', () => {
  assert.equal(canonicalStringify({ b: 1, a: 2 }), canonicalStringify({ a: 2, b: 1 }));
  assert.equal(digestOf({ a: 1, b: [1, 2] }), digestOf({ b: [1, 2], a: 1 }));
});

test('digestEquals is length-safe and correct', () => {
  const d = digestOf({ x: 1 });
  assert.ok(digestEquals(d, d));
  assert.ok(!digestEquals(d, 'sha256:deadbeef'));
});

test('prototype-polluting keys are stripped on parse', () => {
  const parsed = parseStructured('{"__proto__": {"polluted": true}, "ok": 1}', 'x.json') as Record<
    string,
    unknown
  >;
  // Global prototype must not have been polluted.
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
  assert.equal(Object.hasOwn(parsed, '__proto__'), false);
  assert.equal(parsed['ok'], 1);
  const cleaned = stripDangerousKeys({ constructor: 'bad', a: 1 }) as Record<string, unknown>;
  assert.equal(Object.hasOwn(cleaned, 'constructor'), false);
  assert.equal(cleaned['a'], 1);
});

test('YAML alias bombs are bounded (no billion laughs)', () => {
  const bomb = [
    'a: &a ["x","x","x","x","x","x","x","x","x","x"]',
    'b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a,*a]',
    'c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b,*b]',
    'd: [*c,*c,*c,*c,*c,*c,*c,*c,*c,*c]',
  ].join('\n');
  assert.throws(() => parseStructured(bomb, 'bomb.yaml'));
});

test('path traversal is rejected against an explicit root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ibe-test-'));
  writeFileSync(join(dir, 'ok.json'), '{"a":1}');
  assert.doesNotThrow(() => readTextFileSafe('ok.json', { root: dir }));
  assert.throws(
    () => readTextFileSafe('../../../etc/passwd', { root: dir }),
    /escapes allowed root/,
  );
});

test('symlinks are refused by default', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ibe-test-'));
  writeFileSync(join(dir, 'real.json'), '{"a":1}');
  try {
    symlinkSync(join(dir, 'real.json'), join(dir, 'link.json'));
  } catch {
    return; // symlink not permitted in this environment; skip
  }
  assert.throws(() => readTextFileSafe('link.json', { root: dir }), /symlink/);
});

test('oversized input is refused before parsing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ibe-test-'));
  writeFileSync(join(dir, 'big.json'), '0'.repeat(1024));
  assert.throws(() => readTextFileSafe('big.json', { root: dir, maxBytes: 512 }), /exceeds/);
});

test('FixedClock advances deterministically', () => {
  const c = new FixedClock('2026-01-01T00:00:00.000Z');
  const t0 = c.now();
  c.advance(1000);
  assert.equal(c.now(), t0 + 1000);
});
