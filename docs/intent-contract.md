# Intent Contract v2

The Intent Contract is the entry gate of the assurance chain: nothing downstream runs
without a valid, unexpired, complete contract. It is the machine-checkable binding between
a human-declared intent and a proposed change. Contracts are validated with Zod
(`.strict()` — unknown top-level keys are rejected) and fail closed.

Source: `packages/intent/contract.ts` (schema), `completeness.ts` (semantic checks),
`migrate.ts` (v1→v2), `load.ts` (load + hash). CLI: `ibe intent validate <file>`,
`ibe intent compat <v1.json>`.

## Formats

JSON and YAML are both supported. Files are loaded through the hardened loader
(`loadStructuredFile`) which applies path-traversal, symlink, size (5 MiB), YAML-alias,
and prototype-pollution defenses before parsing. `loadIntentFile` then validates and
returns a `LoadedIntent { contract, hash, warnings }` where `hash = digestOf(contract)`
is bound into every downstream capability and certificate.

## Field reference

Top-level `IntentContractV2` (`schema_version: "2.0"`):

| Section | Field | Type / default | Notes |
|---|---|---|---|
| `intent` | `id` | StableId | e.g. `INT-RL-001` |
| | `title` | string (3–200) | |
| | `objective` | string (10–2000) | Prefer measurable statements |
| | `owner` | `{ id, type }` | type: `human`/`service`/`ai_agent` |
| | `created_at` / `expires_at` | ISO-8601 w/ offset | validity window |
| `authority` | `requested_by` | StableId | |
| | `approved_by` | StableId[] = [] | governor ids |
| | `allowed_actions` | ActionId[] = [] | lower_snake, optionally dotted |
| | `approval_required` | ActionId[] = [] | actions needing recorded approval |
| | `prohibited_actions` | ActionId[] = [] | **must include `self_approve`** |
| `scope` | `repositories`, `branches`, `files`, `functions`, `model_elements`, `environments`, `exclusions` | string/StableId[] = [] | at least one of repos/files/model_elements/environments must be set |
| `requirements` | `satisfies`, `preserves` | StableId[] = [] | |
| `invariants` | `[]` of `{ id, description, evaluator }` | evaluator `{ type, reference, operator?, threshold? }` | types: `policy`/`metric`/`model`/`causal`/`property` |
| `risk` | `level` | `low`/`medium`/`high`/`critical` | |
| | `tolerance` | `strict`/`moderate`/`permissive` | drives capability TTL |
| | `maximum_blast_radius` | string (1–120) | e.g. `staging-only` |
| | `maximum_cost_usd` | number ≥ 0 = 0 | |
| `expected_events` | string[] = [] | | expected event types |
| `forbidden_event_patterns` | string[] = [] | | e.g. `ProductionChangeWithoutApproval` |
| `verification` | `required_cases` | StableId[] = [] | e.g. `VER-RATELIMIT-PROP` |
| | `minimum_independent_verifiers` | int ≥ 0 = 1 | |
| `recovery` | `required` | boolean | |
| | `strategy` | `rollback`/`safe-degrade`/`quarantine`/`none` | |
| | `maximum_recovery_time_seconds` | int > 0, ≤ 86_400 | |
| | `safe_state` | string (1–200) | |
| `evidence` | `required_types` | EvidenceType[] = [] | must not be empty (completeness) |

`ActionId` matches `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$` (e.g. `repository.write_branch`,
`terraform.plan`, or the bare governance token `self_approve`). `EvidenceType` is one of
`source-diff`, `policy-decision`, `test-results`, `causal-trace`, `artifact-digest`,
`verifier-attestation`, `provenance`, `model-delta`, `oscal`.

## Completeness checks

`checkCompleteness(contract)` returns structured `errors` (fail closed) and `warnings`.
Errors:

1. `expires_at` must be after `created_at`.
2. **`authority.prohibited_actions` must include `self_approve`** — the doctrine rule,
   verbatim: *"authority.prohibited_actions must include \"self_approve\" (IBE doctrine: a
   builder cannot approve its own work)"*.
3. No action may be both allowed and prohibited.
4. The intent must authorize at least one action (`allowed_actions` or `approval_required`).
5. Scope must constrain at least one repository, file, model element, or environment.
6. For `high`/`critical` risk: at least one verification case, `minimum_independent_verifiers ≥ 1`, and `recovery.required = true`.
7. `evidence.required_types` must not be empty.
8. A `metric` invariant must specify an operator/threshold.

Warnings: missing `policy.modify` in prohibited actions; ambiguous objective terms
(`improve`, `optimize`, `better`, …) — advisory only, the authoritative check is
structural.

## v1 → v2 migration

`migrateV1ToV2(v1, opts)` (behind `ibe intent compat`) upgrades a legacy v1 rate-limiter
intent (`goal`, `scope.files/functions`, metric `invariants`, `risk_tolerance`,
`test_inputs`) to a full v2 contract, filling new mandatory fields with **safe defaults**:
strict/staging-only scope, `prohibited_actions = [self_approve, policy.modify,
secret.export, production.shell]`, `recovery.required = true`, and a standard evidence set.
It is lossless for v1 fields (note: `test_inputs` is not consumed).

## Annotated example

```yaml
schema_version: "2.0"
intent:
  id: INT-RL-001                       # StableId, bound into every capability/certificate
  title: Cap rate limiter at 10 req/key
  objective: >-
    The allow() method of the rate limiter must permit at most 10 requests per key.
  owner: { id: human-patrick, type: human }
  created_at: "2026-06-01T00:00:00.000Z"
  expires_at: "2026-12-31T00:00:00.000Z"   # must be after created_at
authority:
  requested_by: human-patrick
  approved_by: [human-governor-01]          # a governor who may satisfy approval_required
  allowed_actions: [repository.read, repository.write_branch, test.execute]
  approval_required: [production.promote]
  prohibited_actions: [self_approve, policy.modify]  # self_approve is MANDATORY
scope:
  repositories: [rate-limiter]              # >=1 of repos/files/model_elements/environments
  files: [target-service/patched/rate-limiter.ts]
  functions: [allow]                        # function-granularity scope
  model_elements: [CMP-RATELIMIT]
  environments: [development, staging]
  exclusions: [production]
requirements: { satisfies: [], preserves: [] }
invariants:
  - id: INV-MAX-ALLOW
    description: allow_count must be <= 10
    evaluator: { type: metric, reference: allow_count, operator: le, threshold: 10 }
risk:
  level: medium
  tolerance: strict                          # -> 300s capability TTL
  maximum_blast_radius: staging-only
  maximum_cost_usd: 0
expected_events: [BuildCompleted, VerificationPassed, AssuranceCertificateIssued]
forbidden_event_patterns: [ProductionChangeWithoutApproval, PromotionBeforeVerification]
verification:
  required_cases: [VER-RATELIMIT-PROP]
  minimum_independent_verifiers: 1
recovery:
  required: true
  strategy: rollback
  maximum_recovery_time_seconds: 600
  safe_state: previous-approved-version
evidence:
  required_types: [source-diff, policy-decision, test-results, causal-trace, verifier-attestation]
```

Validate it:

```bash
node dist/packages/cli/index.js intent validate intent.yaml
# -> { valid: true, intent_id: "INT-RL-001", hash: "sha256:…", warnings: [] }
```
