/**
 * Information-flow control (§16).
 *
 * Classification-aware analysis over the model's DataFlow elements. These checks
 * turn "don't leak CUI" from prose into machine-checkable model queries used by
 * both the policy engine (data-flow policies) and the assurance kernel.
 */

import { Reason, reason } from '../shared/index.js';
import type { ModelGraph } from './graph.js';
import type { DataClassificationT } from './entities.js';

const SENSITIVE: DataClassificationT[] = ['CUI', 'SECRET', 'PROPRIETARY'];

function isSensitive(c: DataClassificationT): boolean {
  return SENSITIVE.includes(c);
}

export interface DataFlowFinding {
  dataflow: string;
  reason: Reason;
}

/**
 * Evaluate every DataFlow against the six required checks:
 *  - sensitive data to a public endpoint / external egress
 *  - cross-tenant data flow
 *  - secrets written to logs
 *  - CUI sent to an unauthorized external processor
 *  - unencrypted sensitive transport
 *  - egress outside the permitted allowlist
 */
export function checkInformationFlows(graph: ModelGraph): DataFlowFinding[] {
  const findings: DataFlowFinding[] = [];

  const publicInterfaces = new Set(
    graph
      .ofKind('Interface')
      .filter((i) => i.public)
      .map((i) => i.id),
  );
  const productionEnvs = new Set(
    graph
      .ofKind('Environment')
      .filter((e) => e.production)
      .map((e) => e.id),
  );

  const tenantOf = (id: string): string | undefined => {
    const el = graph.get(id);
    if (el && el.kind === 'DataFlow') return el.tenant;
    // Look for a tenant tag on component via relationships is out of scope; use name heuristic off.
    return undefined;
  };

  for (const df of graph.ofKind('DataFlow')) {
    const sensitive = isSensitive(df.classification);

    // 1. Sensitive → public endpoint.
    if (sensitive && (publicInterfaces.has(df.to) || productionEnvs.has(df.to))) {
      findings.push({
        dataflow: df.id,
        reason: reason(
          'INFORMATION_FLOW_VIOLATION',
          `${df.classification} data flow ${df.id} reaches public/production endpoint ${df.to}`,
          { classification: df.classification, to: df.to },
        ),
      });
    }

    // 2. Cross-tenant flow.
    const toTenant = tenantOf(df.to);
    if (df.tenant && toTenant && df.tenant !== toTenant) {
      findings.push({
        dataflow: df.id,
        reason: reason(
          'INFORMATION_FLOW_VIOLATION',
          `cross-tenant flow ${df.id}: ${df.tenant} -> ${toTenant}`,
        ),
      });
    }

    // 3. Secrets written to logs (permitted_storage or destination names a log sink).
    const destName = (graph.get(df.to)?.name ?? df.to).toLowerCase();
    if (
      sensitive &&
      (/log|stdout|telemetry/.test(destName) || df.permitted_storage.some((s) => /log/i.test(s)))
    ) {
      findings.push({
        dataflow: df.id,
        reason: reason(
          'INFORMATION_FLOW_VIOLATION',
          `sensitive data flow ${df.id} written to a log/telemetry sink (${destName})`,
        ),
      });
    }

    // 4. CUI to unauthorized external processor.
    if (
      df.classification === 'CUI' &&
      df.permitted_processors.length > 0 &&
      !df.permitted_processors.includes(df.to)
    ) {
      findings.push({
        dataflow: df.id,
        reason: reason(
          'INFORMATION_FLOW_VIOLATION',
          `CUI flow ${df.id} reaches processor ${df.to} not in permitted_processors`,
        ),
      });
    }

    // 5. Unencrypted sensitive transport.
    if (sensitive && !df.encrypted && df.transport !== 'in-process') {
      findings.push({
        dataflow: df.id,
        reason: reason(
          'INFORMATION_FLOW_VIOLATION',
          `sensitive flow ${df.id} uses unencrypted transport ${df.transport}`,
        ),
      });
    }

    // 6. Egress outside the permitted allowlist (external transport with a
    //    declared allowlist that does not cover the destination).
    if (df.permitted_egress.length > 0 && df.transport !== 'in-process') {
      const allowed = df.permitted_egress.some(
        (e) => destName.includes(e.toLowerCase()) || df.to === e,
      );
      if (!allowed) {
        findings.push({
          dataflow: df.id,
          reason: reason(
            'INFORMATION_FLOW_VIOLATION',
            `flow ${df.id} egresses to ${df.to} outside permitted_egress`,
          ),
        });
      }
    }
  }
  return findings;
}
