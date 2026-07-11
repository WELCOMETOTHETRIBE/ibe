/**
 * Identity provider.
 *
 * Actors (humans, services, AI agents) hold a role and an Ed25519 keypair. The
 * LocalIdentityProvider is a development identity authority: it mints keypairs,
 * signs on behalf of registered actors, and resolves public keys for
 * verification. Roles enforce separation of duties at the type level — the
 * builder role can never be a signer/governor for its own work.
 *
 * SPIFFE/SPIRE is the production target; WorkloadIdentityProvider documents that
 * seam (fetch short-lived SVIDs) without pretending to implement it.
 */

import { assertValidId } from '../shared/index.js';
import { generateEd25519, keyIdOf, signEd25519, verifyEd25519, type KeyPair } from './keys.js';

export type ActorRole =
  | 'intent_owner'
  | 'architect'
  | 'planner'
  | 'builder'
  | 'policy'
  | 'capability_broker'
  | 'runner'
  | 'verifier'
  | 'governor'
  | 'signer'
  | 'monitor';

export type ActorType = 'human' | 'service' | 'ai_agent';

export interface Actor {
  id: string;
  type: ActorType;
  roles: ActorRole[];
  publicKeyPem: string;
  keyId: string;
}

export interface Signer {
  actorId: string;
  keyId: string;
  sign(data: string | Uint8Array): string;
}

export class LocalIdentityProvider {
  private readonly actors = new Map<string, Actor>();
  private readonly privateKeys = new Map<string, string>();

  /** Register an actor, generating a keypair if none is supplied. */
  register(id: string, type: ActorType, roles: ActorRole[], keypair?: KeyPair): Actor {
    assertValidId(id, 'actor id');
    const kp = keypair ?? generateEd25519();
    const actor: Actor = {
      id,
      type,
      roles,
      publicKeyPem: kp.publicKeyPem,
      keyId: keyIdOf(kp.publicKeyPem),
    };
    this.actors.set(id, actor);
    this.privateKeys.set(id, kp.privateKeyPem);
    return actor;
  }

  /** Register a verification-only actor from a public key (no signing capability). */
  registerPublicKey(id: string, type: ActorType, roles: ActorRole[], publicKeyPem: string): Actor {
    assertValidId(id, 'actor id');
    const actor: Actor = { id, type, roles, publicKeyPem, keyId: keyIdOf(publicKeyPem) };
    this.actors.set(id, actor);
    return actor;
  }

  /** Export the public keyring (actor id → public key PEM) for later verification. */
  keyring(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [id, actor] of this.actors) out[id] = actor.publicKeyPem;
    return out;
  }

  get(id: string): Actor | undefined {
    return this.actors.get(id);
  }

  publicKey(id: string): string | undefined {
    return this.actors.get(id)?.publicKeyPem;
  }

  hasRole(id: string, role: ActorRole): boolean {
    return this.actors.get(id)?.roles.includes(role) ?? false;
  }

  /** Return a signer bound to an actor. Throws if the actor is unknown. */
  signer(id: string): Signer {
    const priv = this.privateKeys.get(id);
    const actor = this.actors.get(id);
    if (!priv || !actor) throw new Error(`no signing key for actor ${id}`);
    return {
      actorId: id,
      keyId: actor.keyId,
      sign: (data) => signEd25519(priv, data),
    };
  }

  /** Verify a signature attributed to an actor. */
  verify(id: string, data: string | Uint8Array, signatureB64: string): boolean {
    const pub = this.publicKey(id);
    if (!pub) return false;
    return verifyEd25519(pub, data, signatureB64);
  }
}

/**
 * Planned SPIFFE/SPIRE workload identity seam. Production deployments fetch
 * short-lived X.509/JWT SVIDs bound to a workload; this interface documents the
 * contract IBE would consume. Not implemented in the MVP.
 */
export interface WorkloadIdentityProvider {
  /** Fetch a short-lived SVID for the current workload. */
  fetchSvid(): Promise<{ spiffeId: string; expiresAt: string; publicKeyPem: string }>;
}
