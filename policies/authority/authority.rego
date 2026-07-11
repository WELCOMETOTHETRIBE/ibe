package ibe.authority

# Specification mirror of packages/policy/rules.ts (authority.* rules).
# Authoritative implementation is the TypeScript DeterministicPolicyEngine.

import rego.v1

default allow := false

# The action must be explicitly allowed or approval-gated, and never prohibited.
action_permitted if {
	not prohibited
	input.intent.authority.allowed_actions[_] == input.action
}

action_permitted if {
	not prohibited
	input.intent.authority.approval_required[_] == input.action
}

prohibited if input.intent.authority.prohibited_actions[_] == input.action
prohibited if input.action == "self_approve"
prohibited if input.action == "policy.modify"

# Required approvals: an approval action needs a governor approval on record.
approval_satisfied if {
	not input.intent.authority.approval_required[_] == input.action
}

approval_satisfied if {
	input.intent.authority.approval_required[_] == input.action
	some g
	input.intent.authority.approved_by[_] == g
	input.approvals[_] == g
}

allow if {
	action_permitted
	approval_satisfied
}

reasons contains sprintf("action %q is prohibited", [input.action]) if prohibited
