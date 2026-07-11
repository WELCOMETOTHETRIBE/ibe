/**
 * Compact MBSE-inspired engineering metamodel.
 *
 * This is deliberately NOT a SysML editor. It is the minimum internal model
 * needed to answer traceability/impact/hazard questions and to invalidate stale
 * evidence when the model changes. A SysML v2 adapter can map onto these types
 * later (see sysml-adapter.ts).
 *
 * Every element shares a stable identity, version, owner, status, source
 * reference, and typed relationships. Loading is via Zod so malformed models
 * fail closed.
 */

import { z } from 'zod';
import { StableId } from '../intent/contract.js';

export const DataClassification = z.enum([
  'PUBLIC',
  'INTERNAL',
  'PROPRIETARY',
  'CUI',
  'SECRET',
  'TENANT-SCOPED',
]);
export type DataClassificationT = z.infer<typeof DataClassification>;

export const ElementStatus = z.enum(['draft', 'proposed', 'approved', 'deprecated', 'retired']);

export const RelationType = z.enum([
  'allocatedTo', // Requirement -> Component
  'exposes', // Component -> Interface
  'carries', // Interface -> DataFlow
  'classifiedAs', // DataFlow -> DataClassification (encoded via classification field too)
  'constrains', // Invariant -> Component|Interface
  'verifies', // VerificationCase -> Requirement|Invariant
  'affects', // Decision -> Component
  'mitigatedBy', // Hazard -> Invariant
  'changes', // Intent -> ModelElement (recorded at delta time)
  'supports', // Evidence -> VerificationCase
  'implements', // Release -> ModelVersion
  'dependsOn', // Component -> Component (for assume/guarantee composition)
  'crosses', // DataFlow -> TrustBoundary
  'residesIn', // Component -> Environment
]);
export type RelationTypeT = z.infer<typeof RelationType>;

export const Relationship = z.object({
  type: RelationType,
  target: StableId,
  note: z.string().max(300).optional(),
});

/** Fields shared by every model element. */
const base = {
  id: StableId,
  version: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  owner: StableId,
  status: ElementStatus.default('approved'),
  relationships: z.array(Relationship).default([]),
  /** Where this element is defined/derived from (file, doc, ticket). */
  source: z.string().max(300).default('model'),
};

/** Assume/guarantee contract carried by a Component (see §15). */
export const ComponentContract = z.object({
  assumptions: z.array(z.string().min(1)).default([]),
  guarantees: z.array(z.string().min(1)).default([]),
  on_assumption_failure: z.array(z.string().min(1)).default([]),
});

export const Requirement = z.object({ kind: z.literal('Requirement'), ...base });
export const Component = z.object({
  kind: z.literal('Component'),
  ...base,
  contract: ComponentContract.optional(),
});
export const Interface = z.object({
  kind: z.literal('Interface'),
  ...base,
  public: z.boolean().default(false),
});
export const FunctionEl = z.object({ kind: z.literal('Function'), ...base });
export const DataFlow = z.object({
  kind: z.literal('DataFlow'),
  ...base,
  classification: DataClassification,
  from: StableId,
  to: StableId,
  transport: z
    .enum(['in-process', 'https', 'http', 'grpc', 'queue', 'file', 'unknown'])
    .default('unknown'),
  encrypted: z.boolean().default(false),
  tenant: z.string().max(80).optional(),
  permitted_processors: z.array(StableId).default([]),
  permitted_storage: z.array(StableId).default([]),
  permitted_egress: z.array(z.string()).default([]),
});
export const TrustBoundary = z.object({
  kind: z.literal('TrustBoundary'),
  ...base,
  encloses: z.array(StableId).default([]),
});
export const Environment = z.object({
  kind: z.literal('Environment'),
  ...base,
  production: z.boolean().default(false),
});
export const Actor = z.object({
  kind: z.literal('Actor'),
  ...base,
  actorType: z.enum(['human', 'service', 'ai_agent']).default('service'),
});
export const Decision = z.object({ kind: z.literal('Decision'), ...base });
export const RiskEl = z.object({
  kind: z.literal('Risk'),
  ...base,
  level: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
});
export const Hazard = z.object({ kind: z.literal('Hazard'), ...base });
export const InvariantEl = z.object({
  kind: z.literal('Invariant'),
  ...base,
  policyRef: z.string().max(200).optional(),
});
export const VerificationCase = z.object({
  kind: z.literal('VerificationCase'),
  ...base,
  method: z
    .enum(['unit', 'integration', 'property', 'policy', 'static', 'plan', 'runtime', 'manual'])
    .default('unit'),
});
export const EvidenceRequirement = z.object({ kind: z.literal('EvidenceRequirement'), ...base });
export const Release = z.object({
  kind: z.literal('Release'),
  ...base,
  modelVersion: z.string().max(40),
});

export const ModelElement = z.discriminatedUnion('kind', [
  Requirement,
  Component,
  Interface,
  FunctionEl,
  DataFlow,
  TrustBoundary,
  Environment,
  Actor,
  Decision,
  RiskEl,
  Hazard,
  InvariantEl,
  VerificationCase,
  EvidenceRequirement,
  Release,
]);
export type ModelElementT = z.infer<typeof ModelElement>;
export type ComponentT = z.infer<typeof Component>;
export type DataFlowT = z.infer<typeof DataFlow>;

export const SystemModel = z
  .object({
    model_version: z.string().min(1).max(40),
    name: z.string().min(1).max(200).default('system'),
    elements: z.array(ModelElement),
  })
  .strict();
export type SystemModelT = z.infer<typeof SystemModel>;
