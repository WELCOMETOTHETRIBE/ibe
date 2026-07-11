/**
 * Model import/export adapters.
 *
 * `ModelAdapter` is the seam for future SysML v2 (or Capella/AAS) integration:
 * an adapter maps an external representation to/from the internal SystemModel.
 * We ship one concrete, working adapter — the native JSON/YAML round-trip — and
 * a `SysmlV2Adapter` stub that documents the intended mapping without pretending
 * to implement the full standard (fail closed with NOT_IMPLEMENTED).
 */

import { stringify as toYaml } from 'yaml';
import { canonicalStringify } from '../shared/index.js';
import { SystemModel, type SystemModelT } from './entities.js';

export interface ModelAdapter {
  readonly name: string;
  /** Parse an external document into the internal model. */
  import(raw: unknown): SystemModelT;
  /** Serialize the internal model into the external format (string). */
  export(model: SystemModelT, format?: 'json' | 'yaml'): string;
}

/** The native adapter: the internal format is the canonical exchange format. */
export class NativeModelAdapter implements ModelAdapter {
  readonly name = 'native-json-yaml';
  import(raw: unknown): SystemModelT {
    return SystemModel.parse(raw);
  }
  export(model: SystemModelT, format: 'json' | 'yaml' = 'json'): string {
    const validated = SystemModel.parse(model);
    return format === 'yaml' ? toYaml(validated) : `${canonicalStringify(validated)}\n`;
  }
}

/**
 * Planned SysML v2 adapter. The mapping is documented here so the seam is real;
 * the implementation is intentionally deferred and fails closed rather than
 * emitting a misleading partial model.
 *
 * Intended mapping (SysML v2 KerML/textual → internal):
 *   part def            → Component
 *   port def / port     → Interface
 *   requirement def     → Requirement
 *   action def          → Function
 *   flow / item flow    → DataFlow
 *   constraint/assert   → Invariant
 *   allocation          → allocatedTo relationship
 *   verification case   → VerificationCase
 */
export class SysmlV2Adapter implements ModelAdapter {
  readonly name = 'sysml-v2 (planned)';
  import(_raw: unknown): SystemModelT {
    throw new Error('SysmlV2Adapter.import is not implemented (planned integration seam)');
  }
  export(_model: SystemModelT): string {
    throw new Error('SysmlV2Adapter.export is not implemented (planned integration seam)');
  }
}
