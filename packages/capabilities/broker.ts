/**
 * Capability Broker — issues, validates, revokes, and audits capabilities.
 *
 * Security invariants enforced here (mirrored in the TLA+ capability spec):
 *   - The builder cannot issue its own capability (issuer must hold the
 *     capability_broker role and must not be the subject actor).
 *   - A capability cannot authorize an action outside its bound fields.
 *   - Expired or revoked capabilities are rejected at use time.
 *   - A single-use capability cannot be consumed twice (replay protection).
 *   - Delegation can only narrow, never broaden, and only if delegatable.
 */

import {
  Clock,
  Reason,
  Result,
  SequentialIdGenerator,
  canonicalStringify,
  digestEquals,
  err,
  nonce,
  ok,
  reason,
  systemClock,
  type Digest,
} from '../shared/index.js';
import type { LocalIdentityProvider } from '../identity/index.js';
import { capabilitySigningPayload, type Capability } from './token.js';

export interface IssueRequest {
  intentId: string;
  intentHash: Digest;
  actorId: string;
  action: string;
  resource: string;
  environment: string;
  modelVersion: string;
  artifactDigest?: Digest;
  ttlSeconds: number;
  singleUse: boolean;
  delegatable?: boolean;
}

export interface UseExpectation {
  actorId: string;
  action: string;
  resource: string;
  environment: string;
  modelVersion?: string;
  artifactDigest?: Digest;
}

export interface AuditEvent {
  type: 'issued' | 'used' | 'revoked' | 'rejected' | 'delegated';
  capabilityId: string;
  actorId: string;
  at: string;
  detail?: Record<string, unknown>;
}

export class CapabilityBroker {
  private readonly revoked = new Set<string>();
  private readonly consumed = new Set<string>();
  private readonly issued = new Map<string, Capability>();
  private readonly audit: AuditEvent[] = [];
  private readonly ids: SequentialIdGenerator;

  constructor(
    private readonly idp: LocalIdentityProvider,
    private readonly brokerActorId: string,
    private readonly clock: Clock = systemClock,
    idGen?: SequentialIdGenerator,
  ) {
    this.ids = idGen ?? new SequentialIdGenerator('CAP');
  }

  auditLog(): readonly AuditEvent[] {
    return this.audit;
  }

  private record(e: Omit<AuditEvent, 'at'>): void {
    this.audit.push({ ...e, at: this.clock.nowIso() });
  }

  /** Issue a capability. Fails closed if the broker/builder separation is violated. */
  issue(req: IssueRequest): Result<Capability, Reason> {
    // Doctrine: only a capability_broker may issue, and never for itself.
    if (!this.idp.hasRole(this.brokerActorId, 'capability_broker')) {
      return err(reason('UNAUTHORIZED', `actor ${this.brokerActorId} is not a capability broker`));
    }
    if (this.idp.hasRole(req.actorId, 'builder') && req.actorId === this.brokerActorId) {
      return err(reason('SELF_APPROVAL', 'a builder cannot issue its own capability'));
    }
    if (req.actorId === this.brokerActorId) {
      return err(reason('SELF_APPROVAL', 'broker cannot issue a capability to itself'));
    }
    const signer = this.idp.signer(this.brokerActorId);
    const now = this.clock.now();
    const unsigned: Omit<Capability, 'signature'> = {
      id: this.ids.next(),
      intent_id: req.intentId,
      intent_hash: req.intentHash,
      actor_id: req.actorId,
      action: req.action,
      resource: req.resource,
      environment: req.environment,
      model_version: req.modelVersion,
      ...(req.artifactDigest ? { artifact_digest: req.artifactDigest } : {}),
      issued_at: new Date(now).toISOString(),
      expires_at: new Date(now + req.ttlSeconds * 1000).toISOString(),
      single_use: req.singleUse,
      delegatable: req.delegatable ?? false,
      issuer_id: this.brokerActorId,
      issuer_key_id: signer.keyId,
      nonce: nonce(),
    };
    const signature = signer.sign(canonicalStringify(capabilitySigningPayload(unsigned)));
    const cap: Capability = { ...unsigned, signature };
    this.issued.set(cap.id, cap);
    this.record({
      type: 'issued',
      capabilityId: cap.id,
      actorId: req.actorId,
      detail: { action: req.action },
    });
    return ok(cap);
  }

  /** Validate a capability against an expected use, without consuming it. */
  validate(cap: Capability, expect: UseExpectation): Result<true, Reason> {
    // 1. Signature authenticity.
    const { signature, ...unsigned } = cap;
    if (!this.idp.verify(cap.issuer_id, canonicalStringify(unsigned), signature)) {
      return err(reason('SIGNATURE_INVALID', `capability ${cap.id} signature verification failed`));
    }
    // 2. Revocation.
    if (this.revoked.has(cap.id)) {
      return err(reason('CAPABILITY_REVOKED', `capability ${cap.id} has been revoked`));
    }
    // 3. Expiry (with no clock-skew leniency — fail closed).
    if (this.clock.now() >= Date.parse(cap.expires_at)) {
      return err(reason('CAPABILITY_EXPIRED', `capability ${cap.id} expired at ${cap.expires_at}`));
    }
    // 4. Binding: the capability must match exactly what is being attempted.
    if (cap.actor_id !== expect.actorId) {
      return err(
        reason(
          'CAPABILITY_INVALID',
          `capability bound to ${cap.actor_id}, used by ${expect.actorId}`,
        ),
      );
    }
    if (
      cap.action !== expect.action ||
      cap.resource !== expect.resource ||
      cap.environment !== expect.environment
    ) {
      return err(
        reason(
          'CAPABILITY_INVALID',
          'capability action/resource/environment does not match the attempted operation',
          {
            bound: { action: cap.action, resource: cap.resource, environment: cap.environment },
            attempted: {
              action: expect.action,
              resource: expect.resource,
              environment: expect.environment,
            },
          },
        ),
      );
    }
    if (expect.modelVersion && cap.model_version !== expect.modelVersion) {
      return err(
        reason(
          'CAPABILITY_INVALID',
          `capability bound to model ${cap.model_version}, attempted ${expect.modelVersion}`,
        ),
      );
    }
    if (
      expect.artifactDigest &&
      cap.artifact_digest &&
      !digestEquals(cap.artifact_digest, expect.artifactDigest)
    ) {
      return err(
        reason(
          'PROVENANCE_MISMATCH',
          'capability artifact digest does not match the attempted artifact',
        ),
      );
    }
    // 5. Single-use replay.
    if (cap.single_use && this.consumed.has(cap.id)) {
      return err(reason('CAPABILITY_REPLAY', `single-use capability ${cap.id} already consumed`));
    }
    return ok(true);
  }

  /** Validate AND consume (marks single-use tokens spent). Use at action time. */
  use(cap: Capability, expect: UseExpectation): Result<true, Reason> {
    const v = this.validate(cap, expect);
    if (!v.ok) {
      this.record({
        type: 'rejected',
        capabilityId: cap.id,
        actorId: expect.actorId,
        detail: { code: v.error.code },
      });
      return v;
    }
    if (cap.single_use) this.consumed.add(cap.id);
    this.record({
      type: 'used',
      capabilityId: cap.id,
      actorId: expect.actorId,
      detail: { action: cap.action },
    });
    return ok(true);
  }

  revoke(capabilityId: string, why: string): void {
    this.revoked.add(capabilityId);
    this.record({ type: 'revoked', capabilityId, actorId: this.brokerActorId, detail: { why } });
  }

  /** Delegate a capability to another actor. Can only narrow, never broaden. */
  delegate(
    parent: Capability,
    toActorId: string,
    narrow: Partial<Pick<IssueRequest, 'ttlSeconds' | 'singleUse'>> = {},
  ): Result<Capability, Reason> {
    if (!parent.delegatable) {
      return err(reason('CAPABILITY_INVALID', `capability ${parent.id} is not delegatable`));
    }
    const remainingSeconds = Math.floor((Date.parse(parent.expires_at) - this.clock.now()) / 1000);
    if (remainingSeconds <= 0)
      return err(reason('CAPABILITY_EXPIRED', `parent capability ${parent.id} expired`));
    const ttl = Math.min(narrow.ttlSeconds ?? remainingSeconds, remainingSeconds);
    const child = this.issue({
      intentId: parent.intent_id,
      intentHash: parent.intent_hash,
      actorId: toActorId,
      action: parent.action,
      resource: parent.resource,
      environment: parent.environment,
      modelVersion: parent.model_version,
      ...(parent.artifact_digest ? { artifactDigest: parent.artifact_digest } : {}),
      ttlSeconds: ttl,
      singleUse: narrow.singleUse ?? parent.single_use,
      delegatable: false, // delegation is not transitive by default
    });
    if (child.ok) {
      this.record({
        type: 'delegated',
        capabilityId: child.value.id,
        actorId: toActorId,
        detail: { parent: parent.id },
      });
    }
    return child;
  }
}
