/**
 * Terraform / OpenTofu plan analysis (§24.3). Consumes `terraform show -json`
 * plan output (or a fixture) and detects trust-boundary and information-flow
 * hazards — e.g. a security-group rule opening an administrative port to
 * 0.0.0.0/0, or a resource with public network access enabled. No live cloud
 * credentials are required; a plan JSON fixture drives the default demo.
 */

import { Reason, reason } from '../shared/index.js';

interface TfResourceChange {
  address: string;
  type: string;
  name?: string;
  change?: {
    actions?: string[];
    after?: Record<string, unknown> | null;
  };
}

interface TfPlan {
  resource_changes?: TfResourceChange[];
}

export interface TerraformAnalysis {
  resourceChanges: Array<{ address: string; type: string; actions: string[] }>;
  findings: Reason[];
  trustBoundaryChanged: boolean;
  publicAdminEndpoint: boolean;
  touchesProduction: boolean;
}

const ADMIN_PORTS = new Set([22, 3389, 5985, 5986, 1433, 3306, 5432, 6379, 27017]);
const OPEN_CIDRS = new Set(['0.0.0.0/0', '::/0']);

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function coversAdminPort(from: unknown, to: unknown): boolean {
  const f = Number(from);
  const t = Number(to);
  if (!Number.isFinite(f) || !Number.isFinite(t)) return false;
  if (f === 0 && t === 0) return true; // "all ports"
  for (const p of ADMIN_PORTS) if (p >= f && p <= t) return true;
  return false;
}

export function analyzeTerraformPlan(plan: unknown): TerraformAnalysis {
  const p = (plan ?? {}) as TfPlan;
  const findings: Reason[] = [];
  let trustBoundaryChanged = false;
  let publicAdminEndpoint = false;
  let touchesProduction = false;

  const resourceChanges = (p.resource_changes ?? []).map((rc) => ({
    address: rc.address,
    type: rc.type,
    actions: rc.change?.actions ?? [],
  }));

  for (const rc of p.resource_changes ?? []) {
    const actions = rc.change?.actions ?? [];
    if (!actions.some((a) => a === 'create' || a === 'update')) continue;
    const after = (rc.change?.after ?? {}) as Record<string, unknown>;

    // Production tagging.
    const tags = (after['tags'] ?? {}) as Record<string, unknown>;
    if (
      String(tags['environment'] ?? tags['env'] ?? '').toLowerCase() === 'production' ||
      /prod/i.test(rc.address)
    ) {
      touchesProduction = true;
    }

    // Public network access flags (Azure / generic).
    if (
      after['public_network_access_enabled'] === true ||
      after['public_network_access'] === 'Enabled'
    ) {
      publicAdminEndpoint = true;
      trustBoundaryChanged = true;
      findings.push(
        reason('TRUST_BOUNDARY_VIOLATION', `${rc.address} enables public network access`, {
          address: rc.address,
        }),
      );
    }

    // Security-group / NSG ingress opening admin ports to the world.
    const ingressBlocks = [
      ...asArray(after['ingress']),
      ...asArray(after['security_rule']),
      ...asArray(after['rule']),
    ] as Array<Record<string, unknown>>;
    for (const ing of ingressBlocks) {
      if (!ing || typeof ing !== 'object') continue;
      const cidrs = [
        ...asArray(ing['cidr_blocks']),
        ...asArray(ing['source_address_prefix']),
        ...asArray(ing['source_address_prefixes']),
      ].map(String);
      const openToWorld = cidrs.some(
        (c) => OPEN_CIDRS.has(c) || c === '*' || c.toLowerCase() === 'internet',
      );
      const adminPort = coversAdminPort(
        ing['from_port'] ?? ing['destination_port_range'] ?? ing['port'],
        ing['to_port'] ?? ing['destination_port_range'] ?? ing['port'],
      );
      const access = String(ing['access'] ?? 'Allow');
      if (openToWorld && adminPort && access.toLowerCase() !== 'deny') {
        publicAdminEndpoint = true;
        trustBoundaryChanged = true;
        findings.push(
          reason(
            'TRUST_BOUNDARY_VIOLATION',
            `${rc.address} exposes an administrative port to the public internet`,
            { address: rc.address, cidrs },
          ),
        );
      }
    }
  }

  return {
    resourceChanges,
    findings,
    trustBoundaryChanged,
    publicAdminEndpoint,
    touchesProduction,
  };
}
