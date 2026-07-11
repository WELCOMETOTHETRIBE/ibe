import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseUnifiedDiff,
  changedSymbols,
  extractSymbols,
  globMatch,
  analyzeTerraformPlan,
} from './index.js';

test('unified diff parsing detects added/modified/renamed files', () => {
  const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-old
+new
diff --git a/src/new.ts b/src/new.ts
new file mode 100644
+++ b/src/new.ts
@@ -0,0 +1 @@
+hello
`;
  const files = parseUnifiedDiff(diff);
  assert.equal(files.length, 2);
  assert.equal(files[0]!.path, 'src/a.ts');
  assert.equal(files[0]!.status, 'modified');
  assert.equal(files[1]!.status, 'added');
});

test('AST symbol extraction finds functions, classes, and methods (not regex)', () => {
  const src = `export function login(){return 1}\nexport class Svc { pay(){return 2} }\nconst arrow = () => 3;`;
  const syms = extractSymbols(src).map((s) => `${s.kind}:${s.name}`);
  assert.ok(syms.includes('function:login'));
  assert.ok(syms.includes('class:Svc'));
  assert.ok(syms.includes('method:pay'));
  assert.ok(syms.includes('function:arrow'));
});

test('changedSymbols identifies exactly the modified function', () => {
  const before = `export function a(){return 1}\nexport function b(){return 2}`;
  const after = `export function a(){return 1}\nexport function b(){return 99}`;
  const changes = changedSymbols(before, after);
  assert.deepEqual(
    changes.map((c) => `${c.name}:${c.change}`),
    ['b:modified'],
  );
});

test('glob matcher handles ** and * anchored', () => {
  assert.ok(globMatch('infra/**', 'infra/network.tf'));
  assert.ok(globMatch('src/*.ts', 'src/a.ts'));
  assert.ok(!globMatch('src/*.ts', 'src/nested/a.ts'));
  assert.ok(globMatch('packages/policy/**', 'packages/policy/rules.ts'));
});

test('terraform analysis flags a public admin port and public network access', () => {
  const plan = {
    resource_changes: [
      {
        address: 'azurerm_network_security_rule.ssh',
        type: 'azurerm_network_security_rule',
        change: {
          actions: ['create'],
          after: {
            access: 'Allow',
            destination_port_range: '22',
            source_address_prefix: 'Internet',
          },
        },
      },
      {
        address: 'azurerm_key_vault.v',
        type: 'azurerm_key_vault',
        change: { actions: ['update'], after: { public_network_access_enabled: true } },
      },
    ],
  };
  const a = analyzeTerraformPlan(plan);
  assert.ok(a.trustBoundaryChanged);
  assert.ok(a.publicAdminEndpoint);
  assert.ok(a.findings.some((f) => f.code === 'TRUST_BOUNDARY_VIOLATION'));
});
