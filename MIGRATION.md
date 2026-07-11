# Migration: MVP → AI Engineering Assurance Platform

The original IBE MVP proved the doctrine on a single rate-limiter example. This
release generalizes it into a modular platform while **preserving every core
concept**. Nothing conceptual was deleted without a stronger replacement.

## Old → New mapping

| Old component | New component | Reason for change | Compatibility impact |
|---|---|---|---|
| `src/intent/schema.ts` (rate-limiter-specific types) | `packages/intent/contract.ts` (Intent Contract v2, Zod) | Generalized to any software/infra change; runtime schema validation; JSON+YAML | v1 files migrate via `migrateV1ToV2` / `ibe intent compat` |
| `src/intent/validator.ts` (forbidden-word list) | `packages/intent/completeness.ts` | Moved from word-lists to **structural completeness**; ambiguity kept as advisory | Stricter; adds the `self_approve` doctrine rule |
| `src/intent/parser.ts` | `packages/shared/fs-safe.ts` + `loadIntentFile` | Hardened untrusted-input loading (traversal/symlink/size/YAML-bomb/proto-pollution) | Same JSON support, adds YAML |
| `src/shadow/executor.ts` (in-process) | `packages/execution/*` | Real runner abstraction: Docker isolation + **honestly-labeled** local fallback | In-process is no longer mislabeled as isolation |
| `src/shadow/metrics.ts`, `comparator.ts` | `packages/verification/*` + rate-limiter verifiers | Independent, property-based verification separate from the builder | Behavior observed at runtime, not just metrics diff |
| `src/refusal/engine.ts` (scope by directory enumeration) | `packages/assurance/kernel.ts` + `packages/adapters/scope.ts` | Deterministic 8-gate governing rule; scope via **git diff + ts-morph AST** | Real change analysis instead of directory listing |
| `target-service/baseline`, `target-service/patched` | `examples/rate-limiter/target/{baseline,patched}.ts` | Kept as the canonical demo; clock injected for deterministic property tests | Same intentional "always allow" defect, now refused by verification |
| `intents/*.json` (v1) | retained as v1 compat fixtures | Drive `ibe intent compat` | Still loadable |

## What was added (no prior equivalent)

MBSE system model + impact/traceability (`packages/model`), STPA hazard model
(`packages/hazards`), policy-as-code with structured decisions (`packages/policy`
+ `/policies`), capability-based authority (`packages/capabilities`), causal
event model (`packages/events` + `packages/causal`), provenance/attestation and
evidence freshness (`packages/provenance`), assurance cases + signed certificates
(`packages/assurance`), OSCAL export (`packages/oscal`), TLA+ specs + explicit-
state checker (`formal/`, `packages/formal`), REST API (`packages/api`).

## Compatibility command

The original example still runs end to end via `npm run demo` (the
`rate-limiter` slice), and legacy v1 intent files can be upgraded:

```bash
node dist/packages/cli/index.js intent compat intents/example-intent.json
```

## Removed

`src/` and `target-service/` were removed after their content and concepts were
migrated to `packages/*` and `examples/rate-limiter/*` respectively. The removal
is a refactor, not a loss of capability — every behavior has a stronger home.
