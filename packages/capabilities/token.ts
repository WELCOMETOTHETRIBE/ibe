/**
 * Capability tokens. Authority in IBE is a signed, least-privilege capability —
 * not an ambient RBAC role. Each token is bound to an authenticated actor, an
 * intent (id + hash), a single action/resource/environment, a model version,
 * and optionally an artifact/plan digest. Tokens are time-limited, revocable,
 * optionally single-use, and cryptographically signed by the broker.
 */

import type { Digest } from '../shared/index.js';

export interface Capability {
  id: string;
  intent_id: string;
  intent_hash: Digest;
  /** The authenticated actor/workload this capability is bound to. */
  actor_id: string;
  action: string;
  resource: string;
  environment: string;
  model_version: string;
  /** Optional binding to a specific plan or built artifact. */
  artifact_digest?: Digest;
  issued_at: string;
  expires_at: string;
  single_use: boolean;
  delegatable: boolean;
  /** Parent capability id if this token was delegated. */
  delegated_from?: string;
  issuer_id: string;
  issuer_key_id: string;
  nonce: string;
  signature: string;
}

/** The exact bytes that are signed: the capability minus its own signature. */
export function capabilitySigningPayload(
  cap: Omit<Capability, 'signature'>,
): Omit<Capability, 'signature'> {
  return cap;
}
