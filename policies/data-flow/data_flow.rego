package ibe.dataflow

# Specification mirror of packages/model/dataflow.ts information-flow checks.
import rego.v1

sensitive := {"CUI", "SECRET", "PROPRIETARY"}

# A sensitive data flow that reaches a public endpoint is a violation.
violation contains msg if {
	some df
	df := input.dataflows[_]
	df.classification in sensitive
	df.to_public
	msg := sprintf("%v flow %q reaches a public endpoint", [df.classification, df.id])
}

# Unencrypted sensitive transport is a violation.
violation contains msg if {
	some df
	df := input.dataflows[_]
	df.classification in sensitive
	not df.encrypted
	df.transport != "in-process"
	msg := sprintf("sensitive flow %q uses unencrypted transport", [df.id])
}

default allow := false
allow if count(violation) == 0
