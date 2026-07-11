# Policy

IBE's authorization decisions are made by a **deterministic Policy Decision Point** that
is external to the builder and fails closed: any single deny makes the whole decision a
deny. The engine is dependency-free TypeScript and is **authoritative**; the Rego bundles
under `/policies/**` are a human-readable specification mirror, evaluated by a real `opa`
binary only when one is present.

Source: `packages/policy/rules.ts`, `engine.ts`, `types.ts`, `opa-adapter.ts`; `/policies/*.rego`.

## Deterministic engine

`DeterministicPolicyEngine(rules = RULES, version = POLICY_BUNDLE_VERSION)`:

- **Deterministic order** — rules are sorted by `id.localeCompare` at construction, so
  evaluation order is reproducible.
- **Bundle hash** — computed once as `digestOf({ version, rules: [{id, description}, …] })`.
  This `policy_bundle_hash` is bound into evidence and certificates so the exact policy
  that produced a decision is recorded and verifiable later.
- **Fail-closed evaluation** — each rule runs inside a try/catch; a rule that throws
  contributes a `POLICY_DENIED` reason (`policy rule <id> errored: …`) rather than being
  skipped.

`evaluate(ctx)` merges every rule's contribution (`denies`, `capabilities`, `conditions`,
`requiredApprovals`) and returns a `PolicyDecision`. Capabilities and conditions are
emitted only on an `allow`.

### Decision shape

```jsonc
{
  "decision": "allow" | "deny",
  "reasons": [ /* Reason[] — why it denied */ ],
  "capabilities": [ /* CapabilityGrant[] — only on allow */ ],
  "conditions": [ /* string[] — sorted, only on allow */ ],
  "required_approvals": [ /* string[] — governor ids, always */ ],
  "policy_bundle_hash": "sha256:…",
  "policy_bundle_version": "1.0.0"
}
```

`PolicyContext` (assembled by the orchestrator) carries `now`, `actorId`, `builderId`,
`intent`, `intentHash`, `request` (action/resource/environment), `approvals`, and
optional `model` (`trustBoundaryChanged`, `dataFlowViolations`, `changedElementIds`),
`cost`, `blastRadius`, `evidencePresent`, `verifiers`, `breakGlass`.

## Rule list

`RULES` (`packages/policy/rules.ts`), `POLICY_BUNDLE_VERSION = '1.0.0'`:

| Rule id | Effect |
|---|---|
| `authority.action_permitted` | Deny if the action is prohibited or `self_approve` (`POLICY_DENIED`); deny if not in `allowed_actions`/`approval_required` (`UNAUTHORIZED`) |
| `authority.no_self_approval` | Deny if a governance action (`policy.modify` / `production.promote`) is attempted by the builder itself (`SELF_APPROVAL`); deny any `policy.modify` via this path (`POLICY_DENIED`) |
| `intent.not_expired` | Deny if `now >= intent.expires_at` (`INTENT_EXPIRED`) |
| `scope.environment_allowed` | Deny excluded environments; deny environments outside `scope.environments` (`OUT_OF_SCOPE`) |
| `authority.required_approvals` | For `approval_required` actions, deny unless a designated governor approval is present (`POLICY_DENIED`) |
| `model.trust_boundary_change_requires_approval` | Deny a trust-boundary-altering change without governor approval (`TRUST_BOUNDARY_VIOLATION`); else adds condition `trust-boundary-change-audited` |
| `dataflow.no_information_flow_violations` | Any classification-aware data-flow violation from the model is fatal (`INFORMATION_FLOW_VIOLATION`) |
| `risk.cost_limit` | Deny if estimated cost exceeds `intent.risk.maximum_cost_usd` (`POLICY_DENIED`) |
| `risk.blast_radius_limit` | Deny if a staging-capped intent targets production (`POLICY_DENIED`) |
| `promotion.requires_verification_and_evidence` | For `production.promote`, deny unless enough independent verifiers passed (`VERIFICATION_FAILED`) and required evidence present (`EVIDENCE_INCOMPLETE`); else condition `promotion-gated` |
| `verification.independence` | Deny if verifiers exist but none is independent of the builder (`VERIFIER_NOT_INDEPENDENT`) |
| `capability.issue` | Propose a least-privilege, time-boxed capability (TTL by risk tolerance; `single_use` for sensitive actions) with conditions `network-deny-by-default`, `capture-causal-trace` |
| `break_glass.restricted` | Only a human governor may break-glass, and it never overrides prohibitions (`UNAUTHORIZED` otherwise) |

Capability TTL is set by `expirySeconds(ctx)`: `strict → 300s`, `moderate → 600s`,
default `900s`. Sensitive actions (matching `/(apply|promote|shell|export|write|delete|destroy)/`)
are issued `single_use`.

## Rego mirror + OPA adapter

`/policies/` contains a Rego bundle (`bundle.manifest.json`, version `1.0.0`) mirroring the
TS engine, one package per concern:

| Rego package / file | Mirrors |
|---|---|
| `ibe.authority` (`authority/authority.rego`) | `authority.*` rules |
| `ibe.scope` (`scope/scope.rego`) | scope + protected-path rules (`protected_globs`) |
| `ibe.promotion` (`promotion/promotion.rego`) | `promotion.requires_verification_and_evidence` |
| `ibe.dataflow` (`data-flow/data_flow.rego`) | `packages/model/dataflow.ts` |
| `ibe.resilience` (`resilience/resilience.rego`) | recovery + blast-radius rules |

Each `.rego` file's header states it is a specification mirror of the named TS module, and
`policies/README.md` states the executable authority is the `DeterministicPolicyEngine`.

`OpaCliAdapter` (`opa-adapter.ts`) shells out to `opa eval` when `opa version` succeeds;
otherwise `evaluate()` returns `null` and callers fall back to the built-in engine. It
**never** silently downgrades a deny.

> **Status:** OPA is not installed in the default environment, so the TypeScript engine is
> authoritative and always runs. The Rego bundle is a spec mirror + optional cross-check.

## Versioning & hashing

The policy bundle carries an explicit `POLICY_BUNDLE_VERSION` (`1.0.0`) and a content
`policy_bundle_hash` over `{version, [{id, description}]}`. Both are recorded in evidence
(`policy_version`, and the hash) and in every certificate (`policy_bundle_hash`), so a
change to the ruleset invalidates prior evidence (see [provenance.md](./provenance.md))
and is detectable at certificate-verification time.
