# Provenance

IBE produces supply-chain provenance for every decision, structured in the spirit of
**in-toto / SLSA** and signed with an **identity-bound Ed25519 key**. IBE does **not**
claim conformance to any specific SLSA level — the format is structure-compatible, not
certified. Sigstore-style keyless signing is a planned production upgrade, not a current
claim.

Source: `packages/provenance/attestation.ts`, `evidence.ts`.

## Attestation

`Attestation` is an in-toto-style statement plus detached signatures:

```ts
interface Attestation {
  _type: 'https://in-toto.io/Statement/v1';
  subject: Array<{ name: string; digest: { sha256: string } }>;
  predicateType: 'https://ibe.dev/provenance/v0.2';
  predicate: ProvenancePredicate;
  signatures: Array<{ keyid: string; actor_id: string; sig: string }>;
}
```

`ProvenancePredicate` binds the full chain. Every bound field:

| Field | Binds |
|---|---|
| `intent_id` | Originating intent |
| `intent_hash` | Canonical intent digest |
| `model_version` | System-model version |
| `model_delta_hash` | The hashed model delta |
| `source_repository` | Repository |
| `source_commit` | Exact commit |
| `changed_files` | Files touched |
| `dependency_lockfile_hash` | Supply-chain pin (`lockfileHash`) |
| `build_environment_image_digest` | Build image |
| `builder_identity` | The builder actor |
| `verifier_identities` | Verifier actors |
| `policy_bundle_hash` | Exact policy that judged it |
| `artifact_digest` | The built artifact |
| `causal_trace_root` | Root of the causal event trace |
| `test_result_digests` | Test result hashes |
| `timestamp` | When produced |

`createAttestation(predicate, signer)` signs `canonicalStringify(statement)` with the
signer's Ed25519 key and attaches one identity-bound signature (`keyid`, `actor_id`,
`sig`). `verifyAttestation(att, idp)` returns `PROVENANCE_MISMATCH` if unsigned and
`SIGNATURE_INVALID` for any signature that fails `idp.verify`.

### Promotion-time provenance check

`checkProvenanceForPromotion(att, check, idp)` is the promotion gate. It runs
`verifyAttestation`, then flags `PROVENANCE_MISMATCH` if the artifact digest, source
commit, or policy bundle hash differ from expected, and `SIGNATURE_INVALID` if any signer
is not in the `authorizedSigners` list. This is what stops a verified-elsewhere artifact
from being promoted under a different (unverified) build.

## Evidence objects

Every piece of evidence records the exact context it was collected under and a freshness
window, so the kernel can refuse stale evidence. `EvidenceType` is one of `source-diff |
policy-decision | test-results | causal-trace | artifact-digest | verifier-attestation |
provenance | model-delta | oscal`.

`Evidence` fields:

| Field | Purpose |
|---|---|
| `evidence_id` | Unique id (e.g. `EVD-000001`) |
| `type` | EvidenceType |
| `collected_at` / `collected_by` | When / which actor |
| `context` | `EvidenceContext` — the bound context (below) |
| `content_hash` | Digest of the actual evidence content |
| `freshness_window_seconds` | Default 86_400 (24h) |
| `invalidating_conditions` | The `DEFAULT_INVALIDATION` trigger list |
| `integrity_hash` | Digest of the evidence core (tamper check) |
| `signer_key_id` / `signature` | Ed25519 identity-bound signature |

`EvidenceContext` — a change to any field invalidates the evidence: `model_version`,
`source_commit`, `artifact_digest`, `policy_version`, `verifier_version`,
`trust_boundary_version`, `identity_policy_version`.

## Freshness & invalidation

`DEFAULT_INVALIDATION` (the trigger list, verbatim): `model-element-changed`,
`source-commit-changed`, `artifact-digest-changed`, `policy-bundle-changed`,
`verifier-version-changed`, `trust-boundary-changed`, `identity-policy-changed`,
`freshness-window-elapsed`.

`evidenceStaleReasons(evidence, current, clock)` emits an `EVIDENCE_STALE` reason for each
context field that changed and for age exceeding the freshness window.
`verifyEvidence(evidence, collector, idp)` recomputes the integrity hash (mismatch →
`EVIDENCE_STALE` "tampered") and checks the signature (`SIGNATURE_INVALID`).

The kernel's `evidence-complete` gate refuses when any required evidence is missing OR
stale, so evidence collected against a superseded model delta, commit, or policy bundle
can never silently support a current certificate. This directly implements STPA
constraints SC-4 and SC-6 (see [threat-model.md](./threat-model.md)).

## Signing status

| Aspect | Status |
|---|---|
| Ed25519 identity-bound signing | Implemented (`packages/identity/keys.ts`, pure EdDSA via Node crypto) |
| in-toto / SLSA structure | Implemented (structure-compatible) |
| Certified SLSA level | **Not claimed** |
| Sigstore keyless signing | Planned |
