# Policy bundles (Rego)

These Rego files are the **human-readable specification** of IBE's authorization
rules. The **authoritative, executable** implementation is the dependency-free
`DeterministicPolicyEngine` in `packages/policy`. Both are versioned and hashed;
`ibe policy evaluate` uses the TypeScript engine by default.

When the `opa` binary is present, `OpaCliAdapter` (`packages/policy/opa-adapter.ts`)
can evaluate these bundles instead — it NEVER silently downgrades a deny. The
bundle manifest (`bundle.manifest.json`) is what gets hashed into evidence when
OPA is the decision point.

| Bundle | Rules |
|--------|-------|
| `authority/` | action permitted / prohibited, no self-approval, required approvals |
| `scope/` | authorized files, protected governance paths |
| `promotion/` | verify-before-promote, evidence completeness |
| `data-flow/` | CUI/secret information-flow control |
| `resilience/` | recovery-required, blast radius |
