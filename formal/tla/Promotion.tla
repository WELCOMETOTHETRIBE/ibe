-------------------------------- MODULE Promotion --------------------------------
(***************************************************************************)
(* Formal model of the IBE promotion lifecycle (spec section 14).          *)
(* Mirrored by packages/formal/promotion-spec.ts.                          *)
(*                                                                         *)
(* Safety properties:                                                      *)
(*   - Production promotion cannot occur before verification.              *)
(*   - A refused change cannot be promoted.                                *)
(*   - The builder cannot mark itself independently verified.              *)
(* Liveness (checked as a terminal property in the TS mirror):             *)
(*   - A started deployment eventually reaches verified or rollback.       *)
(***************************************************************************)
EXTENDS Naturals

VARIABLES
  built, verified, builderSelfVerified, approved, refused,
  promoted, deployStarted, deployVerified, rolledBack,
  independentVerifierAvailable

vars == << built, verified, builderSelfVerified, approved, refused,
           promoted, deployStarted, deployVerified, rolledBack,
           independentVerifierAvailable >>

Init ==
  /\ built = FALSE
  /\ verified = FALSE
  /\ builderSelfVerified = FALSE
  /\ approved = FALSE
  /\ refused = FALSE
  /\ promoted = FALSE
  /\ deployStarted = FALSE
  /\ deployVerified = FALSE
  /\ rolledBack = FALSE
  /\ independentVerifierAvailable \in {TRUE, FALSE}

Build ==
  /\ ~built /\ ~refused
  /\ built' = TRUE
  /\ UNCHANGED << verified, builderSelfVerified, approved, refused, promoted,
                  deployStarted, deployVerified, rolledBack, independentVerifierAvailable >>

\* Only an independent verifier may set `verified`.
VerifyIndependent ==
  /\ built /\ ~verified /\ ~refused /\ independentVerifierAvailable
  /\ verified' = TRUE
  /\ UNCHANGED << built, builderSelfVerified, approved, refused, promoted,
                  deployStarted, deployVerified, rolledBack, independentVerifierAvailable >>

\* The builder can *attempt* self-verification, but it does not set `verified`.
BuilderSelfVerify ==
  /\ built /\ ~verified /\ ~refused
  /\ builderSelfVerified' = TRUE
  /\ UNCHANGED << built, verified, approved, refused, promoted,
                  deployStarted, deployVerified, rolledBack, independentVerifierAvailable >>

Approve ==
  /\ built /\ ~approved /\ ~refused
  /\ approved' = TRUE
  /\ UNCHANGED << built, verified, builderSelfVerified, refused, promoted,
                  deployStarted, deployVerified, rolledBack, independentVerifierAvailable >>

Refuse ==
  /\ ~promoted /\ ~refused
  /\ refused' = TRUE
  /\ UNCHANGED << built, verified, builderSelfVerified, approved, promoted,
                  deployStarted, deployVerified, rolledBack, independentVerifierAvailable >>

Promote ==
  /\ ~promoted /\ approved /\ verified /\ ~refused
  /\ promoted' = TRUE
  /\ deployStarted' = TRUE
  /\ UNCHANGED << built, verified, builderSelfVerified, approved, refused,
                  deployVerified, rolledBack, independentVerifierAvailable >>

DeployVerify ==
  /\ deployStarted /\ ~deployVerified /\ ~rolledBack
  /\ deployVerified' = TRUE
  /\ UNCHANGED << built, verified, builderSelfVerified, approved, refused, promoted,
                  deployStarted, rolledBack, independentVerifierAvailable >>

Rollback ==
  /\ deployStarted /\ ~deployVerified /\ ~rolledBack
  /\ rolledBack' = TRUE
  /\ UNCHANGED << built, verified, builderSelfVerified, approved, refused, promoted,
                  deployStarted, deployVerified, independentVerifierAvailable >>

Next == Build \/ VerifyIndependent \/ BuilderSelfVerify \/ Approve \/ Refuse
        \/ Promote \/ DeployVerify \/ Rollback \/ UNCHANGED vars

Spec == Init /\ [][Next]_vars /\ WF_vars(DeployVerify \/ Rollback)

(***************************************************************************)
Inv_NoPromoteBeforeVerify == promoted => verified
Inv_RefusedNeverPromoted  == ~(promoted /\ refused)
Inv_BuilderNotSelfVerified == (builderSelfVerified /\ ~independentVerifierAvailable) => ~verified

\* Liveness: a started deployment eventually gets verified or rolled back.
Recovery == deployStarted ~> (deployVerified \/ rolledBack)
==================================================================================
