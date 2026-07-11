# Assurance Cases & Certificates

Every accepted **or** refused execution produces an evidence-backed assurance case and a
signed certificate. The structure is inspired by SACM / GSN: a top claim, an argument
decomposed over the governing-rule gates, supporting evidence, assumptions,
counter-evidence, residual risk, a confidence status, and the conditions that invalidate
the case.

Source: `packages/assurance/kernel.ts` (gates), `case.ts` (assurance case),
`certificate.ts` (certificate + verification).

## The kernel decision

`decide(input): KernelDecision` evaluates eight gates as pure predicates and accepts only
if **all** pass (`decision = failedGates.length === 0 ? 'accepted' : 'refused'`). No LLM
participates.

| # | Gate id | Passes iff |
|---|---|---|
| 1 | `authorized` | `authority.allowed` |
| 2 | `model-traceable` | `modelTraceability.valid` AND no unresolved assumptions |
| 3 | `within-scope` | no scope violations |
| 4 | `policy-compliant` | no information-flow violations |
| 5 | `causally-valid` | causal conformance AND execution conclusive (else `EXECUTION_FAILED`) |
| 6 | `independently-verified` | independent passes ≥ minimum AND no failed cases |
| 7 | `evidence-complete` | no missing / stale evidence AND no provenance reasons |
| 8 | `recoverable` | recovery not required OR recovery tested |

Gate 5 encodes the fail-closed-on-unknown-execution rule: a timeout / crash /
isolation-unavailable outcome is inconclusive and refused.

## Assurance case structure

`buildAssuranceCase(inputs)` is built the **same way for accept and refuse** —
`AssuranceCase` fields:

| Field | Content |
|---|---|
| `claim` | Accept: the change "earned the right to proceed." Refuse: "did NOT satisfy all assurance gates and is refused." |
| `argument` | One line per gate: `PASS/FAIL — <clause>: satisfied / NOT satisfied` |
| `evidence` | Evidence ids (`EVD-…`) |
| `assumptions` | e.g. `execution runner: local-process (NOT container-isolated) (isolated=false)` |
| `counter_evidence` | Flattened `reasons` of all FAILED gates |
| `residual_risk` | e.g. non-container runner note |
| `confidence` | `refuted` if refused; `low` if accept-with-stale-evidence; else `high` |
| `invalidating_conditions` | Model element / source commit / artifact digest / policy bundle / verifier version / evidence freshness changes |
| `evidence_freshness` | Freshness note |

The `argument` and `counter_evidence` make a refusal self-explaining: the reader sees
which clauses failed and the exact `Reason` codes behind them.

## The signed certificate

A certificate is issued after the kernel decides (`issueCertificate`, ids from
`SequentialIdGenerator('CERT')`). Both forms share `CommonCert` fields: `id`, `intent_id`,
`intent_hash`, `model_version`, `model_delta_hash`, `source_commit`, `artifact_digest`,
`builder_identity`, `verifier_identities`, `policy_bundle_hash`, `causal_trace_root`,
`issued_at`, `signer`, `signer_key_id`, plus the `assurance_case` and an Ed25519
`signature`.

### Acceptance certificate (`decision: 'accepted'`)

Adds: `required_patterns_passed`, `forbidden_patterns_detected`,
`verification_cases_passed`, `rollback_tested`, `execution_isolated`,
`unresolved_assumptions`, `stale_evidence`.

### Refusal certificate (`decision: 'refused'`)

Adds: `failed_gates`, `violations` (`Reason[]`), `missing_evidence`,
`prohibited_event_patterns` (from `FORBIDDEN_EVENT_PATTERN` reasons), `unauthorized_scope`
(from scope violation messages), `residual_findings` (unresolved assumptions + provenance
reasons). All three demo certificates are refusals — see [demo.md](./demo.md).

## Verification

`verifyCertificate(cert, idp): Reason[]` (empty = valid) checks two things:

1. **Signature** — re-serializes the certificate core canonically and checks
   `idp.verify(cert.signer, …, signature)`; failure → `SIGNATURE_INVALID`.
2. **Self-consistency invariants** (accepted certificates only) — an accepted certificate
   fails verification if it secretly carries any of:
   - `forbidden_patterns_detected > 0` → `FORBIDDEN_EVENT_PATTERN`
   - `stale_evidence.length > 0` → `EVIDENCE_STALE`
   - `unresolved_assumptions.length > 0` → `ASSUMPTION_VIOLATION`
   - `assurance_case.confidence === 'refuted'` → `UNKNOWN`

So a forged or tampered "accepted" certificate that internally carries unmet obligations
fails verification even if its signature validated. The CI gate `ibe assurance verify`
depends on this. Verify a certificate:

```bash
node dist/packages/cli/index.js assurance verify \
  evidence/generated/rate-limiter.certificate.json \
  --keyring evidence/generated/INT-RL-001.keyring.json
```

(`--keyring` defaults to `evidence/generated/<intent_id>.keyring.json`.) The same check is
available over HTTP via `POST /assurance/verify`.
