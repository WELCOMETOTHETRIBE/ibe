package ibe.resilience

# Specification mirror of resilience rules (recovery + blast radius).
import rego.v1

default recoverable := false
recoverable if not input.intent.recovery.required
recoverable if input.recovery_tested

default blast_radius_ok := true
blast_radius_ok := false if {
	contains(lower(input.intent.risk.maximum_blast_radius), "staging")
	contains(lower(input.requested_blast_radius), "prod")
}
