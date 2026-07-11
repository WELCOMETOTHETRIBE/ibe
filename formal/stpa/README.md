# STPA analysis of the IBE assurance kernel

This directory documents the Systems-Theoretic Process Analysis (STPA) for IBE
itself. The machine-readable model is `packages/hazards/ibe-self.ts`, exported to
`models/hazards/ibe-self.hazards.yaml`. Run `ibe hazards derive` to see the
controls derived from it.

## Control structure

```
        ┌─────────────────────────────────────────────┐
        │        CTRL-KERNEL (Assurance Governor)       │
        │  deterministic gates + certificate issuance   │
        └───────▲───────────────────────────┬──────────┘
     FB-VERIFY  │ FB-EVENTS                  │ control actions
   (attestations, causal trace)              │ (issue cert, promote, rollback)
        ┌───────┴──────────┐        ┌────────▼─────────┐
        │ CTRL-BROKER      │        │ PROC-PROMOTE      │
        │ Capability Broker│───────▶│ / PROC-EXEC       │
        └───────▲──────────┘  caps  └────────▲─────────┘
                │ requests                    │ proposals
        ┌───────┴──────────┐                  │
        │ CTRL-BUILDER     │──────────────────┘
        │ AI Builder Agent │  (proposal, never authority)
        └──────────────────┘
```

## Losses, hazards, unsafe control actions, constraints

See the eight hazards (H-1 … H-8), their unsafe control actions (UCA-1 … UCA-8),
and the safety/security constraints (SC-1 … SC-8) in the model. Each constraint
`derives` one or more of: a policy rule, an invariant, a required/forbidden event
pattern, and a verification case — which the assurance kernel enforces at run
time. The `SC-3` (verify-before-promote) and `SC-5` (revoked/expired capability)
constraints are additionally proven in `formal/tla/Promotion.tla` and
`formal/tla/Capability.tla`.
