/**
 * The built-in deterministic policy rule set (§8). Each rule is a pure function
 * of the policy context. Rules may deny (with factual reasons), attach
 * conditions, require approvals, or grant capabilities. The engine composes them
 * fail-closed: any single deny → overall deny.
 *
 * These rules are mirrored, for reference and auditability, by Rego bundles
 * under /policies/**. The Rego is the human-readable specification; this
 * TypeScript is the executable, dependency-free enforcement used by default.
 */

import { reason } from '../shared/index.js';
import type { PolicyContext, PolicyRule, RuleContribution } from './types.js';

const SENSITIVE_ACTION = /(apply|promote|shell|export|write|delete|destroy)/;

function expirySeconds(ctx: PolicyContext): number {
  switch (ctx.intent.risk.tolerance) {
    case 'strict':
      return 300;
    case 'moderate':
      return 600;
    default:
      return 900;
  }
}

export const RULES: PolicyRule[] = [
  {
    id: 'authority.action_permitted',
    description:
      'The requested action must be explicitly allowed or approval-gated, and never prohibited.',
    evaluate(ctx): RuleContribution {
      const { action } = ctx.request;
      const a = ctx.intent.authority;
      if (a.prohibited_actions.includes(action) || action === 'self_approve') {
        return {
          denies: [
            reason('POLICY_DENIED', `action "${action}" is prohibited by intent authority`, {
              action,
            }),
          ],
        };
      }
      const permitted = a.allowed_actions.includes(action) || a.approval_required.includes(action);
      if (!permitted) {
        return {
          denies: [
            reason('UNAUTHORIZED', `action "${action}" is not in the intent's authorized actions`, {
              action,
            }),
          ],
        };
      }
      return {};
    },
  },
  {
    id: 'authority.no_self_approval',
    description:
      'A builder identity may never approve or self-authorize; self-governance actions are refused.',
    evaluate(ctx): RuleContribution {
      const { action } = ctx.request;
      if (
        action === 'policy.modify' || action === 'production.promote'
          ? ctx.actorId === ctx.builderId
          : false
      ) {
        return {
          denies: [
            reason(
              'SELF_APPROVAL',
              `builder ${ctx.builderId} cannot perform governance action "${action}"`,
              { action },
            ),
          ],
        };
      }
      if (action === 'policy.modify') {
        return {
          denies: [
            reason(
              'POLICY_DENIED',
              'modifying the policy bundle is not permitted through this path',
              { action },
            ),
          ],
        };
      }
      return {};
    },
  },
  {
    id: 'intent.not_expired',
    description: 'The intent must be within its validity window.',
    evaluate(ctx): RuleContribution {
      const expires = Date.parse(ctx.intent.intent.expires_at);
      if (ctx.now >= expires) {
        return {
          denies: [reason('INTENT_EXPIRED', `intent expired at ${ctx.intent.intent.expires_at}`)],
        };
      }
      return {};
    },
  },
  {
    id: 'scope.environment_allowed',
    description: 'The target environment must be within scope and not excluded.',
    evaluate(ctx): RuleContribution {
      const env = ctx.request.environment;
      const s = ctx.intent.scope;
      if (s.exclusions.includes(env)) {
        return {
          denies: [
            reason('OUT_OF_SCOPE', `environment "${env}" is explicitly excluded by scope`, { env }),
          ],
        };
      }
      if (s.environments.length > 0 && !s.environments.includes(env)) {
        return {
          denies: [
            reason('OUT_OF_SCOPE', `environment "${env}" is not in the authorized scope`, { env }),
          ],
        };
      }
      return {};
    },
  },
  {
    id: 'authority.required_approvals',
    description:
      'Actions in approval_required need a recorded approval from a designated governor.',
    evaluate(ctx): RuleContribution {
      const { action } = ctx.request;
      if (!ctx.intent.authority.approval_required.includes(action)) return {};
      const governors = ctx.intent.authority.approved_by;
      const hasApproval = ctx.approvals.some((a) => governors.includes(a));
      if (!hasApproval) {
        return {
          denies: [
            reason(
              'POLICY_DENIED',
              `action "${action}" requires approval from an authorized governor`,
              { action },
            ),
          ],
          requiredApprovals: governors,
        };
      }
      return {};
    },
  },
  {
    id: 'model.trust_boundary_change_requires_approval',
    description: 'A change that alters a trust boundary requires an explicit governor approval.',
    evaluate(ctx): RuleContribution {
      if (!ctx.model?.trustBoundaryChanged) return {};
      const hasApproval = ctx.approvals.some((a) => ctx.intent.authority.approved_by.includes(a));
      if (!hasApproval) {
        return {
          denies: [
            reason(
              'TRUST_BOUNDARY_VIOLATION',
              'change alters a trust boundary without governor approval',
            ),
          ],
          requiredApprovals: ctx.intent.authority.approved_by,
        };
      }
      return { conditions: ['trust-boundary-change-audited'] };
    },
  },
  {
    id: 'dataflow.no_information_flow_violations',
    description: 'Any classification-aware data-flow violation from the model is fatal.',
    evaluate(ctx): RuleContribution {
      const v = ctx.model?.dataFlowViolations ?? [];
      if (v.length > 0) {
        return { denies: v };
      }
      return {};
    },
  },
  {
    id: 'risk.cost_limit',
    description: 'Estimated cost must not exceed the intent maximum.',
    evaluate(ctx): RuleContribution {
      if (ctx.cost && ctx.cost.estimatedUsd > ctx.intent.risk.maximum_cost_usd) {
        return {
          denies: [
            reason(
              'POLICY_DENIED',
              `estimated cost $${ctx.cost.estimatedUsd} exceeds maximum $${ctx.intent.risk.maximum_cost_usd}`,
            ),
          ],
        };
      }
      return {};
    },
  },
  {
    id: 'risk.blast_radius_limit',
    description: 'The blast radius of the action must be within the intent maximum.',
    evaluate(ctx): RuleContribution {
      const max = ctx.intent.risk.maximum_blast_radius.toLowerCase();
      const requested = (ctx.blastRadius ?? ctx.request.environment).toLowerCase();
      if (max.includes('staging') && /prod/.test(requested)) {
        return {
          denies: [reason('POLICY_DENIED', `blast radius "${requested}" exceeds maximum "${max}"`)],
        };
      }
      return {};
    },
  },
  {
    id: 'promotion.requires_verification_and_evidence',
    description:
      'Production promotion requires passing independent verification and complete evidence.',
    evaluate(ctx): RuleContribution {
      if (ctx.request.action !== 'production.promote') return {};
      const denies = [];
      const independentPassed = (ctx.verifiers ?? []).filter(
        (v) => v.independentOfBuilder && v.passed,
      ).length;
      const need = ctx.intent.verification.minimum_independent_verifiers;
      if (independentPassed < need) {
        denies.push(
          reason(
            'VERIFICATION_FAILED',
            `promotion needs ${need} independent passing verifier(s); have ${independentPassed}`,
          ),
        );
      }
      const missing = ctx.intent.evidence.required_types.filter(
        (t) => !(ctx.evidencePresent ?? []).includes(t),
      );
      if (missing.length > 0) {
        denies.push(
          reason(
            'EVIDENCE_INCOMPLETE',
            `promotion missing required evidence: ${missing.join(', ')}`,
            { missing },
          ),
        );
      }
      return denies.length > 0 ? { denies } : { conditions: ['promotion-gated'] };
    },
  },
  {
    id: 'verification.independence',
    description:
      'At least one verifier must be independent of the builder when any verifier is present.',
    evaluate(ctx): RuleContribution {
      const verifiers = ctx.verifiers ?? [];
      if (verifiers.length === 0) return {};
      if (!verifiers.some((v) => v.independentOfBuilder)) {
        return {
          denies: [reason('VERIFIER_NOT_INDEPENDENT', 'no verifier is independent of the builder')],
        };
      }
      return {};
    },
  },
  {
    id: 'capability.issue',
    description: 'Grant a least-privilege, time-boxed capability for a permitted action.',
    evaluate(ctx): RuleContribution {
      const { action, resource, environment } = ctx.request;
      // Only propose a capability; the engine drops it if any rule denies.
      return {
        capabilities: [
          {
            action,
            resource,
            environment,
            expires_in_seconds: expirySeconds(ctx),
            single_use: SENSITIVE_ACTION.test(action),
          },
        ],
        conditions: ['network-deny-by-default', 'capture-causal-trace'],
      };
    },
  },
  {
    id: 'break_glass.restricted',
    description:
      'Break-glass is only honored for a human governor and never overrides prohibitions.',
    evaluate(ctx): RuleContribution {
      if (!ctx.breakGlass) return {};
      const isGovernor = ctx.intent.authority.approved_by.includes(ctx.actorId);
      if (!isGovernor) {
        return {
          denies: [reason('UNAUTHORIZED', 'break-glass requested by a non-governor actor')],
        };
      }
      return { conditions: ['break-glass-audited', 'break-glass-time-limited'] };
    },
  },
];

export const POLICY_BUNDLE_VERSION = '1.0.0';
