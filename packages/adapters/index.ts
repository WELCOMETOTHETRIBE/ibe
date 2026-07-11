/**
 * @ibe/adapters — connectors between IBE and the outside world: git change
 * analysis, TypeScript AST scope analysis, scope enforcement, and Terraform/
 * OpenTofu plan analysis. (The OpenTelemetry adapter lives in @ibe/events.)
 */

export * from './git.js';
export * from './ast.js';
export * from './scope.js';
export * from './terraform.js';
