package ibe.promotion

# Specification mirror of the promotion.requires_verification_and_evidence rule.
import rego.v1

default allow_promotion := false

independent_passing := count([v | v := input.verifiers[_]; v.independentOfBuilder; v.passed])

evidence_missing := [t | t := input.intent.evidence.required_types[_]; not t in input.evidence_present]

allow_promotion if {
	input.action == "production.promote"
	independent_passing >= input.intent.verification.minimum_independent_verifiers
	count(evidence_missing) == 0
}
