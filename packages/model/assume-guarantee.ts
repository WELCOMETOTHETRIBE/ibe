/**
 * Assume-guarantee component contracts (§15).
 *
 * A component declares what it *assumes* of its dependencies and what it
 * *guarantees* to its callers. Composition is valid only if, for every
 * `dependsOn` edge, the dependency's guarantees discharge this component's
 * assumptions. When they do not, we emit a finding — this is how model
 * composition surfaces a broken required assumption before anything executes.
 */

import { Reason, reason } from '../shared/index.js';
import type { ModelGraph } from './graph.js';

/** Normalize an assumption/guarantee phrase for tolerant matching. */
function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface AssumptionFinding {
  component: string;
  assumption: string;
  reason: Reason;
}

export function validateComposition(graph: ModelGraph): AssumptionFinding[] {
  const findings: AssumptionFinding[] = [];
  const components = graph.ofKind('Component');

  for (const comp of components) {
    if (!comp.contract || comp.contract.assumptions.length === 0) continue;

    // Collect guarantees available from all direct dependencies.
    const deps = comp.relationships.filter((r) => r.type === 'dependsOn').map((r) => r.target);
    const availableGuarantees = new Set<string>();
    for (const depId of deps) {
      const dep = graph.get(depId);
      if (dep && dep.kind === 'Component' && dep.contract) {
        for (const g of dep.contract.guarantees) availableGuarantees.add(norm(g));
      }
    }
    // The component's own environment/interface facts also discharge some
    // assumptions (e.g. "authenticated caller" satisfied by a public=false iface).
    for (const iface of graph.ofKind('Interface')) {
      if (
        comp.relationships.some((r) => r.type === 'exposes' && r.target === iface.id) &&
        !iface.public
      ) {
        availableGuarantees.add('authenticated caller');
      }
    }

    for (const assumption of comp.contract.assumptions) {
      const a = norm(assumption);
      const discharged = [...availableGuarantees].some((g) => g.includes(a) || a.includes(g));
      if (!discharged) {
        findings.push({
          component: comp.id,
          assumption,
          reason: reason(
            'ASSUMPTION_VIOLATION',
            `Component ${comp.id} assumes "${assumption}" but no dependency guarantees it`,
            { component: comp.id, assumption, dependencies: deps },
          ),
        });
      }
    }
  }
  return findings;
}
