# Demos

IBE ships three end-to-end vertical slices. Each drives the full pipeline
(`runPipeline`) with a realistic AI-proposed change that is unsafe in a *different* way,
and each **REFUSES** — producing an evidence-backed refusal certificate that names the
failing gate. Together they demonstrate the three pillars: runtime behavior overrides
claims, scope is enforced, and policy/model/evidence violations are fatal.

Source: `examples/rate-limiter/`, `examples/github-change/`, `examples/terraform-azure/`,
orchestrated by `examples/run-all.ts`.

## Running

```bash
npm run build && npm run demo
```

`npm run demo` maps to `ibe demo run` → `runAllDemos(evidence/generated)`. A build must
precede it because the demos execute the compiled `dist/` output. The run writes evidence
for each demo, then **re-verifies each certificate** from its persisted keyring; the
overall run succeeds (exit 0) only if every demo's decision matches the expected `refused`
**and** its certificate re-verifies.

## Expected outcomes

| Demo | Command context | Refuses on gate(s) | Reason |
|---|---|---|---|
| **rate-limiter** | `INT-RL-001`, `test.execute`, staging | `independently-verified` | `VERIFICATION_FAILED — failed verification cases: VER-RATELIMIT-PROP, VER-RATELIMIT-FAULT` |
| **github-change** | `INT-GH-002`, `repository.write_branch`, development | `authorized`, `within-scope` | `OUT_OF_SCOPE — changed file "src/billing.ts" is outside authorized scope` (authorized: `src/auth.ts`) |
| **terraform-azure** | `INT-TF-003`, `terraform.plan`, staging | `authorized`, `model-traceable`, `policy-compliant`, `independently-verified`, `evidence-complete` | trust-boundary + information-flow + assumption violations, `VER-POLICY` failure, and `EVIDENCE_INCOMPLETE — missing: oscal` |

### rate-limiter — runtime behavior overrides claims

The AI-proposed `patched.ts` `RateLimiter.allow()` **always returns `true`** (it ignores
the token count). The code runs without crashing, so an "it runs" claim would pass — but
the platform-authored, builder-independent verifiers `RateLimiterPropertyVerifier`
(`VER-RATELIMIT-PROP`, 200 trials) and `RateLimiterFailureInjectionVerifier`
(`VER-RATELIMIT-FAULT`) observe more than 10 allows per key and fail. The
`independently-verified` gate refuses.

### github-change — scope enforcement

The intent authorizes exactly `src/auth.ts`. The proposed unified diff edits `src/auth.ts`
(in scope) **and** `src/billing.ts` (out of scope). `parseUnifiedDiff` + ts-morph
`changedSymbols` detect the out-of-scope file; the `within-scope` gate fails. The
`authorized` gate also fails because the pipeline computes `authorityAllowed =
policyAllow && scopeViolations === 0`.

### terraform-azure — model, policy, and evidence

The MacTech CUI Vault change would enable public network access on
`azurerm_key_vault.cui_vault`. `analyzeTerraformPlan` flags a public admin endpoint and
`checkInformationFlows` flags CUI reaching a public endpoint. Additionally the model's
`CMP-APP`/`CMP-CUI-VAULT` assume `authenticated caller` with no guaranteeing dependency,
and the intent requires `oscal` evidence that the base demo does not produce. Five gates
refuse at once — the most comprehensive slice.

## Where evidence is written

All artifacts land in `evidence/generated/`:

| File(s) | Content |
|---|---|
| `<name>.certificate.json` | The signed refusal certificate |
| `<name>.events.json` | The causal event trace |
| `<name>.evidence.json` | The signed evidence objects |
| `<intent_id>.keyring.json` | actor id → Ed25519 public key PEM |
| `terraform-azure.oscal.json` | OSCAL subset (terraform demo only, via `ibe oscal export`) |

## Verifying a certificate

```bash
node dist/packages/cli/index.js assurance verify \
  evidence/generated/rate-limiter.certificate.json \
  --keyring evidence/generated/INT-RL-001.keyring.json
```

`--keyring` defaults to `evidence/generated/<intent_id>.keyring.json`. `verifyCertificate`
checks the Ed25519 signature **and** the certificate's internal self-consistency; it
exits non-zero (fail-closed) if either fails. The same check runs in CI and is available
over HTTP at `POST /assurance/verify`.

## Note on isolation

In the default dev environment Docker is not installed, so the demos use the
honestly-labeled local runner and every certificate records the assumption
`execution runner: local-process (NOT container-isolated) (isolated=false)` with the
matching residual risk. See [execution-isolation.md](./execution-isolation.md).

## The accept path exists

The refusals are not because the kernel always refuses. `examples/e2e.test.ts` includes a
synthetic case that drives `runPipeline` with an always-passing verifier, a benign
`isolated:true` execution, and a satisfied required pattern — and gets an **accepted**
certificate that re-verifies. The kernel accepts when, and only when, all eight gates pass.
