package ibe.scope

# Specification mirror of packages/adapters/scope.ts + rules.ts scope checks.
import rego.v1

default within_scope := false

protected_globs := ["packages/policy/", "packages/assurance/", "packages/provenance/", "policies/", "formal/", ".github/"]

# A changed file touches protected governance code the builder may not edit.
touches_protected if {
	some f
	input.changed_files[_] == f
	some p
	startswith(f, protected_globs[_])
}

environment_ok if {
	not input.intent.scope.exclusions[_] == input.environment
	input.intent.scope.environments[_] == input.environment
}

within_scope if {
	environment_ok
	not touches_protected
}
