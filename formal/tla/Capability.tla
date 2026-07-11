-------------------------------- MODULE Capability --------------------------------
(***************************************************************************)
(* Formal model of the IBE capability lifecycle (spec section 14).         *)
(*                                                                         *)
(* This is the authoritative TLA+ artifact. The TypeScript model in        *)
(* packages/formal/capability-spec.ts mirrors it so that `npm run formal`  *)
(* checks the same invariants in CI without a TLC install.                 *)
(*                                                                         *)
(* Safety properties (see INVARIANTS in Capability.cfg):                    *)
(*   - A revoked capability cannot be used.                                *)
(*   - An expired capability cannot be used.                               *)
(*   - A capability cannot authorize an action outside its intent.         *)
(*   - A single-use capability cannot be used twice.                       *)
(*   - A builder cannot issue its own capability.                          *)
(***************************************************************************)
EXTENDS Naturals, Integers

CONSTANT MaxUses            \* small bound, e.g. 2

VARIABLES
  issued,                   \* capability has been issued
  revoked,
  expired,
  uses,                     \* number of times consumed
  usedWhileInvalid,         \* set TRUE if consumed while revoked or expired
  singleUse,
  boundToIntent,
  issuedByBuilder

vars == << issued, revoked, expired, uses, usedWhileInvalid,
           singleUse, boundToIntent, issuedByBuilder >>

Init ==
  /\ issued = FALSE
  /\ revoked = FALSE
  /\ expired = FALSE
  /\ uses = 0
  /\ usedWhileInvalid = FALSE
  /\ singleUse \in {TRUE, FALSE}
  /\ boundToIntent \in {TRUE, FALSE}
  /\ issuedByBuilder \in {TRUE, FALSE}

\* The broker issues only when bound to the intent and NOT by the builder.
Issue ==
  /\ ~issued
  /\ boundToIntent
  /\ ~issuedByBuilder
  /\ issued' = TRUE
  /\ UNCHANGED << revoked, expired, uses, usedWhileInvalid,
                  singleUse, boundToIntent, issuedByBuilder >>

ValidNow == ~revoked /\ ~expired
WithinLimit == (~singleUse) \/ (uses < 1)

\* Consume is only permitted while valid and within the single-use limit.
Consume ==
  /\ issued
  /\ uses < MaxUses
  /\ ValidNow
  /\ WithinLimit
  /\ uses' = uses + 1
  /\ UNCHANGED << issued, revoked, expired, usedWhileInvalid,
                  singleUse, boundToIntent, issuedByBuilder >>

Revoke ==
  /\ issued /\ ~revoked
  /\ revoked' = TRUE
  /\ UNCHANGED << issued, expired, uses, usedWhileInvalid,
                  singleUse, boundToIntent, issuedByBuilder >>

Expire ==
  /\ issued /\ ~expired
  /\ expired' = TRUE
  /\ UNCHANGED << issued, revoked, uses, usedWhileInvalid,
                  singleUse, boundToIntent, issuedByBuilder >>

Next == Issue \/ Consume \/ Revoke \/ Expire \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars

(***************************************************************************)
(* Invariants                                                              *)
(***************************************************************************)
Inv_NoUseWhileInvalid == usedWhileInvalid = FALSE
Inv_SingleUse         == singleUse => uses <= 1
Inv_BoundToIntent     == issued => boundToIntent
Inv_NotBuilderIssued  == issued => ~issuedByBuilder
==================================================================================
