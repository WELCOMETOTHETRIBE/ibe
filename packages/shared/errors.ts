/**
 * Structured, machine-readable errors and refusal reasons.
 *
 * Every negative outcome in IBE carries a stable `code` (for policy/automation)
 * and a human-readable `message`. Refusal reasons are data, not prose blobs.
 */

export type IbeErrorCode =
  | 'SCHEMA_INVALID'
  | 'INTENT_EXPIRED'
  | 'INTENT_INCOMPLETE'
  | 'AMBIGUOUS'
  | 'UNAUTHORIZED'
  | 'OUT_OF_SCOPE'
  | 'POLICY_DENIED'
  | 'MODEL_INVALID'
  | 'MODEL_UNTRACEABLE'
  | 'TRUST_BOUNDARY_VIOLATION'
  | 'INFORMATION_FLOW_VIOLATION'
  | 'HAZARD_UNMITIGATED'
  | 'CAPABILITY_INVALID'
  | 'CAPABILITY_EXPIRED'
  | 'CAPABILITY_REVOKED'
  | 'CAPABILITY_REPLAY'
  | 'SELF_APPROVAL'
  | 'EXECUTION_FAILED'
  | 'ISOLATION_UNAVAILABLE'
  | 'CAUSAL_INVALID'
  | 'FORBIDDEN_EVENT_PATTERN'
  | 'REQUIRED_PATTERN_MISSING'
  | 'RECOVERY_OBLIGATION_UNMET'
  | 'VERIFICATION_FAILED'
  | 'VERIFIER_NOT_INDEPENDENT'
  | 'EVIDENCE_INCOMPLETE'
  | 'EVIDENCE_STALE'
  | 'SIGNATURE_INVALID'
  | 'PROVENANCE_MISMATCH'
  | 'ASSUMPTION_VIOLATION'
  | 'INPUT_TOO_LARGE'
  | 'MALFORMED_INPUT'
  | 'UNKNOWN';

/** A single, factual reason a gate failed. Safe to serialize into evidence. */
export interface Reason {
  readonly code: IbeErrorCode;
  readonly message: string;
  /** Optional structured detail; must never contain secrets. */
  readonly detail?: Record<string, unknown>;
}

export function reason(
  code: IbeErrorCode,
  message: string,
  detail?: Record<string, unknown>,
): Reason {
  return detail === undefined ? { code, message } : { code, message, detail };
}

export class IbeError extends Error {
  readonly code: IbeErrorCode;
  readonly detail?: Record<string, unknown>;
  constructor(code: IbeErrorCode, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'IbeError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
  toReason(): Reason {
    return reason(this.code, this.message, this.detail);
  }
}
