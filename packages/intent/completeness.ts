/**
 * Structured completeness & ambiguity checks for Intent Contract v2.
 *
 * The original MVP judged intent quality primarily by a forbidden-word list.
 * That is retained only as a low-severity *ambiguity signal*. The authoritative
 * check is now structural: does the contract contain the fields required to make
 * a downstream authority/scope/verification decision, and are those fields
 * internally consistent? Anything missing or contradictory fails closed.
 */

import { Reason, reason } from '../shared/index.js';
import type { IntentContract } from './contract.js';

/** Words that historically signaled a vague, non-checkable objective. Now advisory. */
const AMBIGUOUS_WORDS = [
  'improve',
  'better',
  'optimize',
  'enhance',
  'clean',
  'modernize',
  'simplify',
  'nice',
  'elegant',
  'performance',
  'quality',
  'efficiency',
];

export interface CompletenessReport {
  errors: Reason[];
  warnings: Reason[];
}

export function checkCompleteness(c: IntentContract): CompletenessReport {
  const errors: Reason[] = [];
  const warnings: Reason[] = [];

  // --- Temporal coherence -------------------------------------------------
  const created = Date.parse(c.intent.created_at);
  const expires = Date.parse(c.intent.expires_at);
  if (expires <= created) {
    errors.push(
      reason('INTENT_INCOMPLETE', 'expires_at must be after created_at', {
        created_at: c.intent.created_at,
        expires_at: c.intent.expires_at,
      }),
    );
  }

  // --- Doctrine: the builder can never self-approve -----------------------
  const prohibited = new Set(c.authority.prohibited_actions);
  if (!prohibited.has('self_approve')) {
    errors.push(
      reason(
        'INTENT_INCOMPLETE',
        'authority.prohibited_actions must include "self_approve" (IBE doctrine: a builder cannot approve its own work)',
      ),
    );
  }
  if (!prohibited.has('policy.modify')) {
    warnings.push(
      reason(
        'INTENT_INCOMPLETE',
        'authority.prohibited_actions should include "policy.modify" so the builder cannot alter its own acceptance criteria',
      ),
    );
  }

  // --- Authority / allowed vs prohibited must not conflict ----------------
  const allowed = new Set(c.authority.allowed_actions);
  for (const a of allowed) {
    if (prohibited.has(a)) {
      errors.push(
        reason('INTENT_INCOMPLETE', `action "${a}" is both allowed and prohibited`, { action: a }),
      );
    }
  }
  if (allowed.size === 0 && c.authority.approval_required.length === 0) {
    errors.push(reason('INTENT_INCOMPLETE', 'intent authorizes no actions at all'));
  }

  // --- Scope must bind the change to *something* --------------------------
  const hasScope =
    c.scope.repositories.length +
      c.scope.files.length +
      c.scope.model_elements.length +
      c.scope.environments.length >
    0;
  if (!hasScope) {
    errors.push(
      reason(
        'INTENT_INCOMPLETE',
        'scope must constrain at least one repository, file, model element, or environment',
      ),
    );
  }

  // --- Risk-proportionate obligations -------------------------------------
  const highRisk = c.risk.level === 'high' || c.risk.level === 'critical';
  if (highRisk) {
    if (c.verification.required_cases.length === 0) {
      errors.push(
        reason(
          'INTENT_INCOMPLETE',
          `risk.level=${c.risk.level} requires at least one verification.required_case`,
        ),
      );
    }
    if (c.verification.minimum_independent_verifiers < 1) {
      errors.push(
        reason(
          'INTENT_INCOMPLETE',
          `risk.level=${c.risk.level} requires minimum_independent_verifiers >= 1`,
        ),
      );
    }
    if (!c.recovery.required) {
      errors.push(
        reason('INTENT_INCOMPLETE', `risk.level=${c.risk.level} requires recovery.required=true`),
      );
    }
  }

  // --- Evidence completeness contract -------------------------------------
  if (c.evidence.required_types.length === 0) {
    errors.push(reason('INTENT_INCOMPLETE', 'evidence.required_types must not be empty'));
  }

  // --- Invariant evaluator references must be resolvable-looking ----------
  for (const inv of c.invariants) {
    if (inv.evaluator.type === 'metric' && inv.evaluator.operator === undefined) {
      errors.push(
        reason(
          'INTENT_INCOMPLETE',
          `invariant ${inv.id}: metric evaluator requires an operator/threshold`,
          {
            invariant: inv.id,
          },
        ),
      );
    }
  }

  // --- Ambiguity (advisory only) ------------------------------------------
  const objectiveLower = c.intent.objective.toLowerCase();
  for (const w of AMBIGUOUS_WORDS) {
    if (new RegExp(`\\b${w}\\b`).test(objectiveLower)) {
      warnings.push(
        reason(
          'AMBIGUOUS',
          `objective contains ambiguous term "${w}"; prefer a measurable, checkable statement`,
          {
            term: w,
          },
        ),
      );
    }
  }

  return { errors, warnings };
}
