/**
 * OSCAL export for the MacTech CUI Vault example, mapping components to a subset
 * of NIST SP 800-171 controls. Driven by the assurance result's gates.
 */

import { exportOscal, type ControlMapping } from '../../packages/oscal/index.js';
import type { PipelineResult } from '../../packages/orchestrator/index.js';

const CONTROL_MAPPINGS: ControlMapping[] = [
  {
    componentId: 'CMP-CUI-VAULT',
    controlIds: ['3.1.3', '3.13.1', '3.13.16', '3.1.20'],
    status: 'partial',
    statement: 'CUI vault must remain private; IBE refuses changes that expose it publicly.',
  },
  {
    componentId: 'CMP-APP',
    controlIds: ['3.1.1', '3.3.1', '3.14.6'],
    status: 'partial',
    statement:
      'Access control and audit logging enforced by the assurance kernel and capability broker.',
  },
];

export function exportForResult(result: PipelineResult): Record<string, unknown> {
  return exportOscal({
    systemName: 'MacTech CUI Vault',
    modelVersion: 'TF-1.0.0',
    components: [
      {
        id: 'CMP-CUI-VAULT',
        name: 'CUI Vault',
        description: 'Stores CUI at rest.',
        responsibleRole: 'system-owner',
      },
      {
        id: 'CMP-APP',
        name: 'Application tier',
        description: 'Reads CUI from the vault.',
        responsibleRole: 'developer',
      },
    ],
    controlMappings: CONTROL_MAPPINGS,
    gates: result.gates,
    evidenceRefs: result.evidence.map((e) => e.evidence_id),
    decision: result.decision,
    timestamp: result.certificate.issued_at,
    certificateId: result.certificate.id,
    artifactDigest: result.certificate.artifact_digest,
  });
}
