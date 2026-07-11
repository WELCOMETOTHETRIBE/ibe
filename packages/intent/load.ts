/**
 * Loading, validating, and hashing intent contracts.
 * Fail-closed: any schema or completeness error yields a refusal (Err), never a
 * partially-trusted contract.
 */

import { z } from 'zod';
import {
  Clock,
  Reason,
  Result,
  digestOf,
  err,
  loadStructuredFile,
  ok,
  reason,
  systemClock,
  type Digest,
} from '../shared/index.js';
import { IntentContractV2, type IntentContract } from './contract.js';
import { checkCompleteness, type CompletenessReport } from './completeness.js';

export interface LoadedIntent {
  contract: IntentContract;
  /** Canonical hash of the full contract — bound into every capability and certificate. */
  hash: Digest;
  warnings: Reason[];
}

function zodToReasons(error: z.ZodError): Reason[] {
  return error.issues.map((i) =>
    reason('SCHEMA_INVALID', `${i.path.join('.') || '<root>'}: ${i.message}`, {
      path: i.path.join('.'),
      code: i.code,
    }),
  );
}

/** Validate an already-parsed value into a contract (schema + completeness). */
export function validateIntent(raw: unknown): Result<LoadedIntent, Reason[]> {
  const parsed = IntentContractV2.safeParse(raw);
  if (!parsed.success) {
    return err(zodToReasons(parsed.error));
  }
  const contract = parsed.data;
  const report: CompletenessReport = checkCompleteness(contract);
  if (report.errors.length > 0) {
    return err(report.errors);
  }
  return ok({ contract, hash: digestOf(contract), warnings: report.warnings });
}

/** Load a contract from a JSON/YAML file with full untrusted-input defenses. */
export function loadIntentFile(path: string, root?: string): Result<LoadedIntent, Reason[]> {
  let raw: unknown;
  try {
    raw = loadStructuredFile(path, root ? { root } : {});
  } catch (e) {
    return err([reason('MALFORMED_INPUT', e instanceof Error ? e.message : String(e))]);
  }
  return validateIntent(raw);
}

/** Time-dependent validity: expiry is evaluated against an injectable clock. */
export function evaluateIntentValidity(
  contract: IntentContract,
  clock: Clock = systemClock,
): Result<true, Reason> {
  const now = clock.now();
  const expires = Date.parse(contract.intent.expires_at);
  if (now >= expires) {
    return err(
      reason(
        'INTENT_EXPIRED',
        `intent ${contract.intent.id} expired at ${contract.intent.expires_at}`,
        {
          now: clock.nowIso(),
        },
      ),
    );
  }
  return ok(true);
}
