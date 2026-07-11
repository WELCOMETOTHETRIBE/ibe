/**
 * OpenTelemetry adapter (§12). Maps IBE causal events to OTel-compatible spans
 * (128-bit trace id, 64-bit span id, parent span id). IBE's causal semantics
 * remain the source of truth; this is an export view for telemetry backends. Ids
 * are derived deterministically from event ids so a trace is reproducible.
 */

import { createHash } from 'node:crypto';
import type { Event } from './envelope.js';

export interface OtelSpan {
  traceId: string; // 32 hex chars
  spanId: string; // 16 hex chars
  parentSpanId?: string;
  name: string;
  startTimeUnixNano: string;
  attributes: Record<string, unknown>;
  status: { code: 'OK' | 'ERROR' | 'UNSET' };
}

function hex(input: string, bytes: number): string {
  return createHash('sha256')
    .update(input)
    .digest('hex')
    .slice(0, bytes * 2);
}

function statusFor(outcome: Event['outcome']): OtelSpan['status']['code'] {
  if (outcome === 'success') return 'OK';
  if (outcome === 'failure' || outcome === 'refused') return 'ERROR';
  return 'UNSET';
}

/** Convert an intent's event set to OTel spans sharing one trace id. */
export function toOtelSpans(events: Event[], traceSeed?: string): OtelSpan[] {
  const intentId = events[0]?.intent_id ?? 'trace';
  const traceId = hex(traceSeed ?? intentId, 16);
  return events.map((e) => ({
    traceId,
    spanId: hex(e.event_id, 8),
    ...(e.parent_event_ids[0] ? { parentSpanId: hex(e.parent_event_ids[0], 8) } : {}),
    name: e.event_type,
    startTimeUnixNano: `${Date.parse(e.occurred_at) * 1_000_000}`,
    attributes: {
      'ibe.event_id': e.event_id,
      'ibe.intent_id': e.intent_id,
      'ibe.actor_id': e.actor_id,
      ...(e.capability_id ? { 'ibe.capability_id': e.capability_id } : {}),
      ...(e.model_version ? { 'ibe.model_version': e.model_version } : {}),
    },
    status: { code: statusFor(e.outcome) },
  }));
}
