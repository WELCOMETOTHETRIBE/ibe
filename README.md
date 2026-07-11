# Intent-Bound Execution (IBE) MVP

A minimal system to prove the Intent-Bound Execution doctrine.

## Core Doctrine

- All code changes must be explicitly tied to a human-declared intent.
- Intent must be machine-checkable, not descriptive prose.
- AI-generated code is treated as a proposal, never authority.
- Runtime reality (metrics, behavior) overrides tests and static reasoning.
- The system must be capable of refusing unsafe or ambiguous changes.

## What This Is NOT

- Not a test framework
- Not a CI/CD system
- Not a code review tool
- Not a linter or formatter
- Not a code generator
- Not an AI assistant
- Not a monitoring system
- Not a debugging tool

## Usage

```bash
npm run build
node dist/cli.js <intent-file.json>
```

## Project Structure

- `src/intent/` - Intent schema, validation, and parsing
- `src/shadow/` - Shadow execution engine
- `src/refusal/` - Refusal logic
- `target-service/baseline/` - Immutable baseline implementation
- `target-service/patched/` - Proposed changes
- `intents/` - Intent declarations

