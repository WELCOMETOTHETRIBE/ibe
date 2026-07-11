# System Model (MBSE)

IBE binds changes to an authoritative, machine-checkable model of the system. The model is
a compact MBSE-inspired metamodel — not a SysML editor — that supports traceability,
impact analysis, hashed deltas, assume-guarantee composition, and information-flow control.
The authoritative model cannot be silently rewritten to match implementation behavior:
deltas are explicit, hashed, and drive evidence invalidation.

Source: `packages/model/entities.ts`, `graph.ts`, `delta.ts`, `assume-guarantee.ts`,
`dataflow.ts`, `sysml-adapter.ts`, `load.ts`.

## Metamodel entities

A `SystemModel` is a `.strict()` object (`model_version`, `name`, `elements[]`).
`ModelElement` is a discriminated union on `kind` over 15 entity types. Every element
shares base fields (`id`, `version`, `name`, `description`, `owner`, `status`,
`relationships`, `source`).

| Kind | Notable fields |
|---|---|
| `Requirement` | base |
| `Component` | `contract?` (assume-guarantee) |
| `Interface` | `public` |
| `Function` | base |
| `DataFlow` | `classification`, `from`, `to`, `transport`, `encrypted`, `tenant?`, `permitted_processors`, `permitted_storage`, `permitted_egress` |
| `TrustBoundary` | `encloses[]` |
| `Environment` | `production` |
| `Actor` | `actorType` (human/service/ai_agent) |
| `Decision` | base |
| `Risk` | `level` |
| `Hazard` | base |
| `Invariant` | `policyRef?` |
| `VerificationCase` | `method` |
| `EvidenceRequirement` | base |
| `Release` | `modelVersion` |

`DataClassification` = `PUBLIC | INTERNAL | PROPRIETARY | CUI | SECRET | TENANT-SCOPED`.
`ElementStatus` = `draft | proposed | approved | deprecated | retired`.

## Relationships

`RelationType` (14) defines the traceable edges:

| Relation | Meaning |
|---|---|
| `allocatedTo` | Requirement → Component |
| `exposes` | Component → Interface |
| `carries` | Interface → DataFlow |
| `classifiedAs` | DataFlow → DataClassification |
| `constrains` | Invariant → Component/Interface |
| `verifies` | VerificationCase → Requirement/Invariant |
| `affects` | Decision → Component |
| `mitigatedBy` | Hazard → Invariant |
| `changes` | Intent → ModelElement (recorded at delta time) |
| `supports` | Evidence → VerificationCase |
| `implements` | Release → ModelVersion |
| `dependsOn` | Component → Component (assume-guarantee composition) |
| `crosses` | DataFlow → TrustBoundary |
| `residesIn` | Component → Environment |

`ModelGraph` builds an id index and a reverse-adjacency map and offers `get`, `has`,
`ofKind`, and `validate()` (referential integrity — duplicate ids → `MODEL_INVALID`;
dangling relationship / dataflow endpoints → `MODEL_UNTRACEABLE`).

## Impact analysis queries answered

`ModelGraph.impactOf(changedElementIds)` computes the reverse closure of a change and
returns an `ImpactResult` answering:

- **Which components / interfaces are affected?** (`affectedComponents`, `affectedInterfaces`)
- **Which trust boundaries are altered?** (`trustBoundariesAltered` — boundaries enclosing
  a changed element, or a changed DataFlow that `crosses` them)
- **Which verification cases must rerun?** (`verificationCasesToRerun` — cases that
  `verifies` a changed element)
- **Which hazards become relevant?** (`relevantHazards`)
- **Which requirements are touched?** (`requirementsTouched`)

This is what lets IBE decide which evidence is now stale and which checks must rerun after
a change.

## Model delta & evidence invalidation

`computeModelDelta(base, proposed): ModelDelta` diffs two `ModelGraph`s: `added`,
`removed`, and `modified` (per element: `changedFields`, `beforeHash`, `afterHash` from
`digestOf`), plus `changedElementIds` and a stable `deltaHash`
(`digestOf({baseVersion, proposedVersion, added, removed, modified: [{id, changedFields,
afterHash}]})` — deliberately excluding `beforeHash`).

The `deltaHash` is bound into capabilities and certificates. Evidence collected against a
superseded delta is automatically stale (see [provenance.md](./provenance.md)), so the
authoritative model cannot be silently rewritten to make a change look compliant.

## Assume-guarantee contracts

A `Component` may declare a `ComponentContract` (`assumptions`, `guarantees`,
`on_assumption_failure`). `validateComposition(graph)` checks, for every component with
assumptions, that each assumption is discharged by a guarantee of a direct `dependsOn`
dependency (substring match either direction), plus the synthetic guarantee
`authenticated caller` when the component exposes a non-public interface. Undischarged
assumptions become `ASSUMPTION_VIOLATION` findings — which fail the kernel's
`model-traceable` gate (as in the terraform-azure demo, where `CMP-APP` and
`CMP-CUI-VAULT` assume `authenticated caller` with nothing guaranteeing it).

## Information-flow classification

`checkInformationFlows(graph)` evaluates every `DataFlow` against six checks, all
producing `INFORMATION_FLOW_VIOLATION`:

1. Sensitive classification (`CUI`/`SECRET`/`PROPRIETARY`) reaching a public interface or production environment.
2. Cross-tenant flow (source and destination tenant differ).
3. Secrets written to logs/telemetry (by destination name or `permitted_storage`).
4. CUI to a processor not in `permitted_processors`.
5. Unencrypted sensitive transport (not `in-process`).
6. Egress outside the `permitted_egress` allowlist.

These findings feed the policy engine (`dataflow.no_information_flow_violations`) and the
kernel's `policy-compliant` gate.

## SysML v2 adapter (planned seam)

`ModelAdapter` is the import/export seam. `NativeModelAdapter` (`native-json-yaml`) is the
shipped, working adapter (JSON/YAML ↔ the internal canonical model). `SysmlV2Adapter`
(`sysml-v2 (planned)`) is a **stub that fails closed** — both `import` and `export` throw
"not implemented (planned integration seam)". Its file header documents the intended SysML
v2 mapping (`part def → Component`, `port def → Interface`, `requirement def →
Requirement`, `action def → Function`, `flow/item flow → DataFlow`, `constraint/assert →
Invariant`, `allocation → allocatedTo`, `verification case → VerificationCase`) so the
contract is defined even though the adapter is not yet built.

> **Status:** the native JSON/YAML model is fully implemented; SysML v2 is an
> interface + documented mapping only, and refuses rather than emitting a misleading
> partial model.
