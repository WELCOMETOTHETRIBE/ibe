/**
 * Causal event envelope (§12), inspired by the useful semantics of Rapide:
 * typed events with stable ids, explicit parent (causal) links, partial ordering
 * and outcomes. The envelope is the common currency between execution, the
 * causal engine, verification, and evidence.
 */

import { z } from 'zod';
import { StableId } from '../intent/contract.js';

export const EventOutcome = z.enum(['success', 'failure', 'pending', 'refused']);

export const EventEnvelope = z
  .object({
    event_id: StableId,
    event_type: z.string().min(1).max(80),
    occurred_at: z.string().datetime({ offset: true }),
    actor_id: StableId,
    intent_id: StableId,
    action_id: StableId.optional(),
    capability_id: StableId.optional(),
    model_version: z.string().max(40).optional(),
    parent_event_ids: z.array(StableId).default([]),
    artifact_digest: z.string().max(120).optional(),
    evidence_refs: z.array(StableId).default([]),
    outcome: EventOutcome,
    /** Free-form typed attributes; must never carry secrets. */
    attributes: z.record(z.unknown()).default({}),
  })
  .strict();

export type Event = z.infer<typeof EventEnvelope>;

/** Validate an untrusted event object. */
export function parseEvent(raw: unknown): Event {
  return EventEnvelope.parse(raw);
}
