/**
 * STPA-inspired hazard registry (§7).
 *
 * Systems-Theoretic Process Analysis models accidents as the result of unsafe
 * *control actions*, not just component failures. IBE encodes the STPA skeleton
 * as data so that safety/security constraints can be mechanically derived into
 * policies, invariants, required/forbidden event patterns, and verification
 * cases — closing the loop between hazard analysis and runtime enforcement.
 */

import { z } from 'zod';
import { StableId } from '../intent/contract.js';

export const UcaType = z.enum([
  'provided',
  'not-provided',
  'wrong-timing',
  'wrong-order',
  'wrong-duration',
]);

export const Loss = z.object({ id: StableId, description: z.string().min(3) });

export const Hazard = z.object({
  id: StableId,
  description: z.string().min(3),
  leadsTo: z.array(StableId).default([]), // Loss ids
});

export const UnsafeControlAction = z.object({
  id: StableId,
  controller: StableId,
  controlAction: z.string().min(1),
  type: UcaType,
  context: z.string().min(1),
  hazards: z.array(StableId).default([]),
});

/** What a constraint derives into the enforcement layers. */
export const Derivation = z.object({
  policies: z.array(z.string()).default([]),
  invariants: z.array(z.string()).default([]),
  requiredEventPatterns: z.array(z.string()).default([]),
  forbiddenEventPatterns: z.array(z.string()).default([]),
  verificationCases: z.array(StableId).default([]),
});

export const SafetyConstraint = z.object({
  id: StableId,
  description: z.string().min(3),
  mitigatesUca: z.array(StableId).default([]),
  derives: Derivation.default({}),
});

export const Controller = z.object({ id: StableId, name: z.string().min(1) });
export const ControlledProcess = z.object({ id: StableId, name: z.string().min(1) });
export const FeedbackPath = z.object({
  id: StableId,
  from: StableId,
  to: StableId,
  description: z.string().default(''),
});
export const Mitigation = z.object({
  id: StableId,
  description: z.string().min(3),
  implementsConstraint: z.array(StableId).default([]),
});

export const HazardModel = z
  .object({
    name: z.string().default('hazard-analysis'),
    losses: z.array(Loss).default([]),
    hazards: z.array(Hazard).default([]),
    unsafeControlActions: z.array(UnsafeControlAction).default([]),
    constraints: z.array(SafetyConstraint).default([]),
    controllers: z.array(Controller).default([]),
    controlledProcesses: z.array(ControlledProcess).default([]),
    feedbackPaths: z.array(FeedbackPath).default([]),
    mitigations: z.array(Mitigation).default([]),
  })
  .strict();

export type HazardModelT = z.infer<typeof HazardModel>;
export type SafetyConstraintT = z.infer<typeof SafetyConstraint>;
