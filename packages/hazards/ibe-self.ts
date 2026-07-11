/**
 * The IBE assurance system's own STPA hazard model (§7 required example).
 *
 * IBE is a safety-critical controller: if *it* fails, unsafe AI-generated
 * changes get promoted. This model names the eight required hazards and derives
 * the concrete controls (forbidden event patterns, policies, verification cases)
 * that the kernel enforces at runtime. It is the reference the docs and tests
 * point at, and it is exported to models/hazards/ibe-self.hazards.yaml.
 */

import type { HazardModelT } from './registry.js';

export const IBE_SELF_HAZARDS: HazardModelT = {
  name: 'ibe-assurance-kernel-stpa',
  losses: [
    { id: 'L-1', description: 'Unsafe AI-generated change reaches production.' },
    { id: 'L-2', description: 'Sensitive/CUI data is disclosed or exfiltrated.' },
    { id: 'L-3', description: 'A change is accepted without sufficient, valid evidence.' },
    { id: 'L-4', description: 'A failed change cannot be recovered to a safe state.' },
  ],
  hazards: [
    {
      id: 'H-1',
      description: 'AI builder modifies production without valid approval.',
      leadsTo: ['L-1'],
    },
    {
      id: 'H-2',
      description: 'AI builder receives broader authority than the intent requires.',
      leadsTo: ['L-1', 'L-2'],
    },
    {
      id: 'H-3',
      description: 'A deployment is promoted before independent verification.',
      leadsTo: ['L-1', 'L-3'],
    },
    {
      id: 'H-4',
      description: 'Evidence is missing but a certificate is still issued.',
      leadsTo: ['L-3'],
    },
    {
      id: 'H-5',
      description: 'A revoked or expired capability remains usable.',
      leadsTo: ['L-1', 'L-2'],
    },
    {
      id: 'H-6',
      description: 'A model change silently invalidates prior security evidence.',
      leadsTo: ['L-3'],
    },
    {
      id: 'H-7',
      description: 'A failed deployment does not reach rollback or a safe state.',
      leadsTo: ['L-4'],
    },
    {
      id: 'H-8',
      description: 'The builder modifies the policy that evaluates its own change.',
      leadsTo: ['L-1', 'L-3'],
    },
  ],
  controllers: [
    { id: 'CTRL-KERNEL', name: 'Assurance Kernel (governor)' },
    { id: 'CTRL-BROKER', name: 'Capability Broker' },
    { id: 'CTRL-BUILDER', name: 'AI Builder Agent' },
  ],
  controlledProcesses: [
    { id: 'PROC-PROMOTE', name: 'Promotion / deployment' },
    { id: 'PROC-EXEC', name: 'Isolated execution' },
  ],
  feedbackPaths: [
    { id: 'FB-EVENTS', from: 'PROC-EXEC', to: 'CTRL-KERNEL', description: 'Causal event trace' },
    {
      id: 'FB-VERIFY',
      from: 'PROC-EXEC',
      to: 'CTRL-KERNEL',
      description: 'Independent verifier attestations',
    },
  ],
  unsafeControlActions: [
    {
      id: 'UCA-1',
      controller: 'CTRL-BUILDER',
      controlAction: 'promote',
      type: 'provided',
      context: 'without human approval recorded',
      hazards: ['H-1'],
    },
    {
      id: 'UCA-2',
      controller: 'CTRL-BROKER',
      controlAction: 'issue capability',
      type: 'provided',
      context: 'broader than intent authority',
      hazards: ['H-2'],
    },
    {
      id: 'UCA-3',
      controller: 'CTRL-KERNEL',
      controlAction: 'promote',
      type: 'wrong-order',
      context: 'before verification completes',
      hazards: ['H-3'],
    },
    {
      id: 'UCA-4',
      controller: 'CTRL-KERNEL',
      controlAction: 'issue certificate',
      type: 'provided',
      context: 'with incomplete evidence',
      hazards: ['H-4'],
    },
    {
      id: 'UCA-5',
      controller: 'CTRL-BROKER',
      controlAction: 'accept capability',
      type: 'provided',
      context: 'after revocation/expiry',
      hazards: ['H-5'],
    },
    {
      id: 'UCA-6',
      controller: 'CTRL-KERNEL',
      controlAction: 'reuse evidence',
      type: 'provided',
      context: 'after model delta changed the element',
      hazards: ['H-6'],
    },
    {
      id: 'UCA-7',
      controller: 'CTRL-KERNEL',
      controlAction: 'rollback',
      type: 'not-provided',
      context: 'after a failed deployment',
      hazards: ['H-7'],
    },
    {
      id: 'UCA-8',
      controller: 'CTRL-BUILDER',
      controlAction: 'modify policy bundle',
      type: 'provided',
      context: 'that evaluates its own change',
      hazards: ['H-8'],
    },
  ],
  constraints: [
    {
      id: 'SC-1',
      description: 'Production changes require a causally-prior recorded human approval.',
      mitigatesUca: ['UCA-1'],
      derives: {
        policies: ['policy.promotion.requires_human_approval'],
        forbiddenEventPatterns: ['ProductionChangeWithoutApproval'],
        verificationCases: ['VER-PROMOTE-APPROVAL'],
        invariants: [],
        requiredEventPatterns: [],
      },
    },
    {
      id: 'SC-2',
      description: 'Issued capabilities must be a subset of the intent authority.',
      mitigatesUca: ['UCA-2'],
      derives: {
        policies: ['policy.capability.subset_of_intent'],
        forbiddenEventPatterns: ['CapabilityExceedsIntent'],
        verificationCases: ['VER-CAP-SUBSET'],
        invariants: [],
        requiredEventPatterns: [],
      },
    },
    {
      id: 'SC-3',
      description: 'Promotion must be causally preceded by passing independent verification.',
      mitigatesUca: ['UCA-3'],
      derives: {
        policies: ['policy.promotion.requires_verification'],
        requiredEventPatterns: ['IntentAuthorized->VerificationPassed->AssuranceCertificateIssued'],
        forbiddenEventPatterns: ['PromotionBeforeVerification'],
        verificationCases: ['VER-PROMOTE-ORDER'],
        invariants: [],
      },
    },
    {
      id: 'SC-4',
      description:
        'A certificate cannot be issued unless all intent-required evidence is present and fresh.',
      mitigatesUca: ['UCA-4'],
      derives: {
        policies: ['policy.evidence.completeness'],
        invariants: ['INV-EVIDENCE-COMPLETE'],
        verificationCases: ['VER-EVIDENCE-COMPLETE'],
        forbiddenEventPatterns: [],
        requiredEventPatterns: [],
      },
    },
    {
      id: 'SC-5',
      description: 'A revoked or expired capability must be rejected at use time.',
      mitigatesUca: ['UCA-5'],
      derives: {
        policies: ['policy.capability.valid_at_use'],
        invariants: ['INV-CAP-VALID'],
        verificationCases: ['VER-CAP-LIFECYCLE'],
        forbiddenEventPatterns: ['RevokedCapabilityUsed'],
        requiredEventPatterns: [],
      },
    },
    {
      id: 'SC-6',
      description:
        'Evidence tied to a model element must be invalidated when that element changes.',
      mitigatesUca: ['UCA-6'],
      derives: {
        policies: ['policy.evidence.freshness'],
        invariants: ['INV-EVIDENCE-FRESH'],
        verificationCases: ['VER-EVIDENCE-FRESH'],
        forbiddenEventPatterns: [],
        requiredEventPatterns: [],
      },
    },
    {
      id: 'SC-7',
      description: 'A started deployment must eventually reach verified or rolled-back/safe state.',
      mitigatesUca: ['UCA-7'],
      derives: {
        policies: ['policy.resilience.recovery_required'],
        requiredEventPatterns: ['DeploymentStarted~>(DeploymentVerified|RollbackCompleted)'],
        verificationCases: ['VER-RECOVERY'],
        forbiddenEventPatterns: [],
        invariants: [],
      },
    },
    {
      id: 'SC-8',
      description:
        'A builder cannot modify the policy bundle or evidence-generation code for its own change.',
      mitigatesUca: ['UCA-8'],
      derives: {
        policies: ['policy.scope.no_self_governance_edit'],
        forbiddenEventPatterns: ['BuilderModifiedOwnPolicy'],
        verificationCases: ['VER-NO-SELF-GOVERNANCE'],
        invariants: [],
        requiredEventPatterns: [],
      },
    },
  ],
  mitigations: [
    {
      id: 'M-1',
      description: 'Deterministic gate ordering in the assurance kernel.',
      implementsConstraint: ['SC-3'],
    },
    {
      id: 'M-2',
      description: 'Capability subset check at issuance and at use.',
      implementsConstraint: ['SC-2', 'SC-5'],
    },
    {
      id: 'M-3',
      description: 'Evidence freshness invalidation keyed on model/commit/policy/artifact hashes.',
      implementsConstraint: ['SC-4', 'SC-6'],
    },
    {
      id: 'M-4',
      description: 'Protected-path scope rule blocking builder edits to governance code.',
      implementsConstraint: ['SC-8'],
    },
  ],
};
