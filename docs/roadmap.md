# Roadmap & Maturity

IBE is a working, coherent, production-*oriented* platform — not a finished product. This
page states plainly what is real, partial, planned, or research, and what remains for
production hardening. The guiding rule: **IBE never overstates a capability it did not
actually exercise.**

## Maturity by capability area

| Capability area | Status | Justification |
|---|---|---|
| **IBE doctrine proof** (self-hazard model → enforced controls) | **Implemented** | 8-hazard STPA self-model (`hazards/ibe-self.ts`) mechanically derives the policies, invariants, event patterns, and verification cases the kernel enforces; the builder-cannot-self-govern rule is enforced at five layers and proven in TLA+ |
| **Generic assurance kernel** (deterministic 8-gate decision) | **Implemented** | `assurance/kernel.ts` `decide()` is a pure fail-closed AND-of-gates; produces signed accept/refuse certificates verified by `verifyCertificate` |
| **MBSE integration** (metamodel, impact, delta, assume-guarantee, info-flow) | **Implemented (native)** / **Partial (SysML)** | Native JSON/YAML model, `ModelGraph.impactOf`, hashed `computeModelDelta`, `validateComposition`, `checkInformationFlows` all work; SysML v2 adapter is an interface + documented mapping only (stub throws) |
| **Causal runtime assurance** (event graph + pattern grammar) | **Implemented** | `CausalGraph` (cycle/missing-parent/ordering/ancestry) + required/forbidden/recovery grammar + named forbidden catalog; OTel export view. Store is in-memory only |
| **Capability security** (signed, bound, revocable, single-use, delegable) | **Implemented + Proven** | `CapabilityBroker` issue/validate/revoke/single-use/delegate; 5 invariants proven in `formal/tla/Capability.tla` and checked in CI via the TS mirror. Broker state is in-memory (single process) |
| **Supply-chain provenance** (in-toto/SLSA-style, Ed25519) | **Partial** | Structure-compatible in-toto statement + evidence freshness/invalidation, Ed25519 identity-bound signing. NOT certified to any SLSA level; Sigstore keyless signing planned |
| **Compliance evidence** (OSCAL subset, NIST 800-171 mapping) | **Partial** | Documented OSCAL subset (component-definition + assessment-results) with 9 mapped 800-171 controls and explicit implemented/omitted field lists. NOT a CMMC certification |
| **Production SaaS/PaaS readiness** | **Research / early** | Dependency-free REST control plane (`packages/api`) exists; but no persistence, multi-tenancy, HA, or real distributed stores yet |

### Cross-cutting honesty notes

| Feature | Reality |
|---|---|
| **Execution isolation** | Docker runner is real, but Docker is not installed in the default env, so the labeled non-isolated local runner is used and every certificate records `isolated=false`. |
| **Policy / OPA** | The deterministic TypeScript engine is authoritative and always runs; the Rego bundles + OPA adapter are a spec mirror used only when `opa` is present. |
| **Formal methods** | The TLA+ specs are authoritative, but TLC is not vendored (`run-tlc.sh` exits 0 if the jar is absent), so the equivalent TypeScript explicit-state checker (`npm run formal`) is the enforcing CI gate. |
| **SLSA / CMMC** | Structure-compatible only — NOT certified to any SLSA level and NOT a CMMC certification. |
| **SPIFFE/SPIRE & SysML v2** | Seams / interfaces only (`WorkloadIdentityProvider`, `SysmlV2Adapter`), not implemented. |

## Remaining production-hardening

The following are known gaps between the current MVP and a hardened multi-tenant service:

- **Real distributed capability store** — replace the in-process `CapabilityBroker` state
  (`issued`/`revoked`/`consumed` sets) with a durable, replicated store so revocation and
  single-use survive restarts and scale across nodes.
- **SPIFFE/SPIRE workload identity** — implement `WorkloadIdentityProvider.fetchSvid()`
  and retire `LocalIdentityProvider` for production.
- **Real OPA bundle CI** — build, sign, and publish the Rego bundle and run OPA as a
  cross-check against the TS engine in CI (currently OPA is optional/absent).
- **Sigstore keyless signing** — move from static Ed25519 keys to Sigstore-style keyless
  signing with transparency-log inclusion for provenance and certificates.
- **Vendored TLC in CI** — run the authoritative TLA+ specs under TLC in CI (today a
  best-effort, `continue-on-error` job) rather than relying solely on the TS mirror.
- **Persistent event & evidence stores** — replace the in-memory `EventStore` and
  evidence handling with durable, queryable, append-only storage.
- **Multi-tenant isolation** — tenant-scoped identities, policy bundles, and evidence with
  hard isolation between tenants.
- **High availability** — replicated, stateless control-plane instances behind the REST
  API with shared durable state.
- **Container isolation by default** — ship/require the Docker runner (or a stronger
  sandbox) in production so certificates can assert `isolated=true`.
- **SysML v2 / Capella / AAS adapters** — implement the `ModelAdapter` seam beyond the
  native JSON/YAML format.
- **Secrets & key management** — integrate a KMS/HSM for signing keys instead of local
  `.ibe/keys`.
