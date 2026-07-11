/**
 * Derive enforcement artifacts from hazard constraints. This is the mechanism
 * that makes STPA constraints executable: the assurance kernel consumes the
 * derived forbidden/required patterns and required verification cases.
 */

import { Reason, Result, err, loadStructuredFile, ok, reason } from '../shared/index.js';
import { HazardModel, type HazardModelT } from './registry.js';

export interface DerivedControls {
  policies: string[];
  invariants: string[];
  requiredEventPatterns: string[];
  forbiddenEventPatterns: string[];
  verificationCases: string[];
}

export function deriveControls(model: HazardModelT): DerivedControls {
  const out: DerivedControls = {
    policies: [],
    invariants: [],
    requiredEventPatterns: [],
    forbiddenEventPatterns: [],
    verificationCases: [],
  };
  for (const c of model.constraints) {
    out.policies.push(...c.derives.policies);
    out.invariants.push(...c.derives.invariants);
    out.requiredEventPatterns.push(...c.derives.requiredEventPatterns);
    out.forbiddenEventPatterns.push(...c.derives.forbiddenEventPatterns);
    out.verificationCases.push(...c.derives.verificationCases);
  }
  const dedupe = (a: string[]) => [...new Set(a)].sort();
  return {
    policies: dedupe(out.policies),
    invariants: dedupe(out.invariants),
    requiredEventPatterns: dedupe(out.requiredEventPatterns),
    forbiddenEventPatterns: dedupe(out.forbiddenEventPatterns),
    verificationCases: dedupe(out.verificationCases),
  };
}

/** Referential integrity for a hazard model. */
export function validateHazardModel(model: HazardModelT): Reason[] {
  const errors: Reason[] = [];
  const lossIds = new Set(model.losses.map((l) => l.id));
  const hazardIds = new Set(model.hazards.map((h) => h.id));
  const ucaIds = new Set(model.unsafeControlActions.map((u) => u.id));
  for (const h of model.hazards) {
    for (const l of h.leadsTo) {
      if (!lossIds.has(l))
        errors.push(reason('MODEL_UNTRACEABLE', `hazard ${h.id} leadsTo unknown loss ${l}`));
    }
  }
  for (const u of model.unsafeControlActions) {
    for (const hz of u.hazards) {
      if (!hazardIds.has(hz))
        errors.push(reason('MODEL_UNTRACEABLE', `UCA ${u.id} references unknown hazard ${hz}`));
    }
  }
  for (const c of model.constraints) {
    for (const u of c.mitigatesUca) {
      if (!ucaIds.has(u))
        errors.push(reason('MODEL_UNTRACEABLE', `constraint ${c.id} mitigates unknown UCA ${u}`));
    }
  }
  return errors;
}

export function loadHazardFile(path: string, root?: string): Result<HazardModelT, Reason[]> {
  let raw: unknown;
  try {
    raw = loadStructuredFile(path, root ? { root } : {});
  } catch (e) {
    return err([reason('MALFORMED_INPUT', e instanceof Error ? e.message : String(e))]);
  }
  const parsed = HazardModel.safeParse(raw);
  if (!parsed.success) {
    return err(
      parsed.error.issues.map((i) => reason('MODEL_INVALID', `${i.path.join('.')}: ${i.message}`)),
    );
  }
  const integrity = validateHazardModel(parsed.data);
  if (integrity.length > 0) return err(integrity);
  return ok(parsed.data);
}
