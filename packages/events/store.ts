/**
 * Event store and an event emitter that stamps ids/timestamps deterministically.
 * The store is append-only in spirit; events are immutable once recorded.
 */

import { Clock, SequentialIdGenerator, systemClock } from '../shared/index.js';
import { EventEnvelope, type Event } from './envelope.js';

export class EventStore {
  private readonly events: Event[] = [];
  private readonly byId = new Map<string, Event>();

  append(event: Event): Event {
    const parsed = EventEnvelope.parse(event);
    if (this.byId.has(parsed.event_id)) {
      throw new Error(`duplicate event id ${parsed.event_id}`);
    }
    this.events.push(parsed);
    this.byId.set(parsed.event_id, parsed);
    return parsed;
  }

  all(): readonly Event[] {
    return this.events;
  }
  get(id: string): Event | undefined {
    return this.byId.get(id);
  }
  forIntent(intentId: string): Event[] {
    return this.events.filter((e) => e.intent_id === intentId);
  }
}

export interface EmitInput {
  event_type: string;
  actor_id: string;
  intent_id: string;
  outcome: Event['outcome'];
  parents?: string[];
  action_id?: string;
  capability_id?: string;
  model_version?: string;
  artifact_digest?: string;
  evidence_refs?: string[];
  attributes?: Record<string, unknown>;
}

/** Convenience emitter that assigns ids/timestamps and appends to a store. */
export class EventEmitter {
  private readonly ids: SequentialIdGenerator;
  constructor(
    private readonly store: EventStore,
    private readonly clock: Clock = systemClock,
    idGen?: SequentialIdGenerator,
  ) {
    this.ids = idGen ?? new SequentialIdGenerator('EV');
  }

  emit(input: EmitInput): Event {
    const event: Event = {
      event_id: this.ids.next(),
      event_type: input.event_type,
      occurred_at: this.clock.nowIso(),
      actor_id: input.actor_id,
      intent_id: input.intent_id,
      parent_event_ids: input.parents ?? [],
      evidence_refs: input.evidence_refs ?? [],
      outcome: input.outcome,
      attributes: input.attributes ?? {},
      ...(input.action_id ? { action_id: input.action_id } : {}),
      ...(input.capability_id ? { capability_id: input.capability_id } : {}),
      ...(input.model_version ? { model_version: input.model_version } : {}),
      ...(input.artifact_digest ? { artifact_digest: input.artifact_digest } : {}),
    };
    return this.store.append(event);
  }
}
