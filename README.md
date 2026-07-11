# Intent-Bound Execution (IBE)

**An AI Engineering Assurance Platform** — the independent control plane that
decides whether an AI-generated software or infrastructure change has *earned the
right to proceed*.

IBE is not an AI coding agent. It is the deterministic engineering authority that
sits between AI builders (coding agents, cloud-operation agents) and the systems
they want to change (Git, CI/CD, Terraform/OpenTofu, Azure, Kubernetes), and
enforces one rule:

```
Authorized
AND Model-traceable
AND Within scope
AND Policy-compliant
AND Causally valid
AND Independently verified
AND Evidence-complete
AND Recoverable
OR REFUSE
```

A passing change yields a **signed Engineering Assurance Certificate** backed by
a full evidence package. A failing change yields an **evidence-backed refusal
certificate** explaining exactly which gate failed and why. No LLM participates
in the decision.

## Core doctrine (non-negotiable, and visible throughout the code)

- Every consequential change is bound to an explicit, machine-checkable **human intent** (`packages/intent`).
- **AI-generated code is a proposal, never authority** — scope, policy, and capability layers refuse anything outside the intent (`packages/adapters/scope.ts`, `packages/policy`, `packages/capabilities`).
- **Runtime behavior overrides claims** — independent verification observes what the code actually does (`packages/verification`, the rate-limiter demo).
- Ambiguous, out-of-scope, unsafe, unverifiable, expired, unsigned, or unauthorized inputs **fail closed** (`packages/shared/result.ts`, every stage).
- The final accept/refuse decision is made by a **deterministic kernel**, not an LLM (`packages/assurance/kernel.ts`).
- The builder can never issue its own capability, self-approve, modify the policy that judges it, or mark itself verified (`packages/capabilities/broker.ts`, `packages/policy/rules.ts`, `packages/adapters/scope.ts` protected paths, and proven in `formal/tla`).

## Quick start

```bash
npm install
npm run build
npm test          # 57 unit / integration / security tests
npm run formal    # explicit-state model checks (capability + promotion lifecycles)
npm run demo      # three end-to-end vertical slices (all REFUSE the unsafe proposal)
```

Minimum acceptance command:

```bash
npm install && npm run build && npm test && npm run lint && npm run demo
```

## What you can run today

| Command | What it does |
|---|---|
| `ibe intent validate <file>` | Validate an Intent Contract v2 (JSON/YAML) |
| `ibe intent compat <v1.json>` | Migrate a legacy v1 rate-limiter intent to v2 |
| `ibe model validate <file>` | Validate an MBSE system model |
| `ibe model diff <base> <proposed>` | Compute a hashed model delta |
| `ibe hazards derive [file]` | Derive policies/invariants/patterns from an STPA model |
| `ibe policy evaluate <intent> <action>` | Get a structured policy decision |
| `ibe capability issue <intent> <action>` | Issue a signed capability token |
| `ibe events validate <trace>` | Validate a causal event trace |
| `ibe formal check` | Run the formal model checks |
| `ibe demo run` | Run all three demos, write evidence + certificates |
| `ibe assurance verify <cert> --keyring <k>` | Verify a signed certificate |
| `ibe oscal export` | Export an OSCAL (NIST 800-171 subset) assessment |

Run the CLI with `node dist/packages/cli/index.js <command>` (or `npm run ibe -- <command>`).
Start the REST control plane with `npm run serve` (see `GET /openapi.json`).

## The enforced chain

```
Human Intent → Intent Contract → Authority → Model Traceability → Model Delta
→ Hazard/Invariant Eval → Capability Issuance → Isolated Execution
→ Causal Event Collection → Independent Verification → Provenance
→ Assurance Case → Signed Certificate → Accept / Refuse / Roll Back / Escalate
```

The orchestrator that wires this is `packages/orchestrator/pipeline.ts`; the
deterministic decision is `packages/assurance/kernel.ts`.

## Repository layout

```
packages/
  shared/        canonical hashing, IO defenses, Result, clock, redacting logger
  intent/        Intent Contract v2 (Zod), completeness checks, v1→v2 migration
  model/         MBSE metamodel, impact/traceability, delta, assume-guarantee, data-flow
  hazards/       STPA registry + derivation; IBE's own hazard model (8 hazards)
  policy/        deterministic Policy Decision Point, bundle hashing, OPA adapter
  identity/      Ed25519 identities, roles, local IdP, SPIFFE seam
  capabilities/  signed, bound, revocable, single-use capability broker
  execution/     runner abstraction; Docker runner + labeled local fallback
  adapters/      git diff, ts-morph AST scope analysis, Terraform plan analysis
  events/        causal event envelope, store, OpenTelemetry adapter
  causal/        causal graph + required/forbidden/recovery pattern evaluation
  verification/  independent verifier framework + platform verifiers
  provenance/    in-toto/SLSA-style attestation, evidence freshness/invalidation
  assurance/     the governing-rule kernel, assurance cases, signed certificates
  oscal/         OSCAL subset export (NIST 800-171 mapping)
  formal/        explicit-state checker mirroring the TLA+ specs
  orchestrator/  end-to-end pipeline wiring the full chain
  cli/           command line
  api/           REST control-plane service
examples/        rate-limiter, github-change, terraform-azure vertical slices
policies/        Rego bundles (human-readable spec mirror of the TS engine)
models/          example system + hazard models
formal/tla/      authoritative TLA+ specifications + TLC configs
docs/            architecture, threat model, trust boundaries, per-subsystem docs
evidence/generated/  demo output (certificates, evidence, event traces)
```

## Honesty about maturity

IBE is a working, coherent, production-*oriented* platform, not a finished
product. It is explicit about what is real vs. planned:

- **Execution isolation:** the Docker runner is real, but Docker is not installed in the default dev environment, so the **honestly-labeled non-isolated local runner** is used. The kernel records this: acceptance certificates carry `execution_isolated: false`, and every assurance case lists the runner and `isolated=false` as an explicit assumption/residual risk. IBE never claims isolation it did not get.
- **Policy:** the deterministic TypeScript engine is authoritative and always runs; the Rego bundles + OPA adapter are a spec mirror used only when `opa` is present.
- **Formal methods:** the TLA+ specs in `formal/tla` are authoritative; TLC is not vendored, so the equivalent TypeScript explicit-state checker (`npm run formal`) is the CI gate and demonstrates that deliberately-unsafe transitions are caught.
- **Supply chain:** provenance is *structure-compatible* with in-toto/SLSA; it is **not** certified to any SLSA level. Signing is Ed25519 (Sigstore keyless is planned).
- **Compliance:** OSCAL export is a documented subset mapped to NIST SP 800-171; it is **not** a CMMC certification.
- **Integration seams:** SPIFFE/SPIRE and SysML v2 are interfaces only.

See `docs/roadmap.md` for the full maturity assessment and `docs/` for
per-subsystem detail. Migration from the original MVP is documented in
[`MIGRATION.md`](./MIGRATION.md).

## License

ISC
