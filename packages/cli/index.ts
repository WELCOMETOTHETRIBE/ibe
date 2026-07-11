#!/usr/bin/env node
/**
 * @ibe/cli — the Intent-Bound Execution command line.
 *
 * Every command prints a machine-parseable JSON result to stdout and exits
 * non-zero on refusal/failure (fail closed). Human-oriented progress goes to
 * stderr. This is the primary way to drive the assurance kernel locally.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadStructuredFile, FixedClock, digestOf } from '../shared/index.js';
import { loadIntentFile, validateIntent, migrateV1ToV2, type IntentV1 } from '../intent/index.js';
import { loadModelFile, computeModelDelta } from '../model/index.js';
import { DeterministicPolicyEngine, type PolicyContext } from '../policy/index.js';
import { CapabilityBroker } from '../capabilities/index.js';
import { LocalIdentityProvider } from '../identity/index.js';
import { EventStore, parseEvent } from '../events/index.js';
import { CausalGraph } from '../causal/index.js';
import {
  deriveControls,
  validateHazardModel,
  IBE_SELF_HAZARDS,
  HazardModel,
} from '../hazards/index.js';
import { runFormalChecks } from '../formal/index.js';
import { verifyCertificate, type Certificate } from '../assurance/index.js';

const OUT_DIR = join(process.cwd(), 'evidence', 'generated');

function print(obj: unknown): void {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}
function fail(obj: unknown): never {
  print(obj);
  process.exit(1);
}
function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}
function flag(args: string[], name: string, def = ''): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : def;
}
function flags(args: string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++)
    if (args[i] === `--${name}` && args[i + 1]) out.push(args[++i] as string);
  return out;
}

async function main(): Promise<void> {
  const [group, sub, ...rest] = process.argv.slice(2);

  switch (`${group} ${sub ?? ''}`.trim()) {
    case 'intent validate': {
      const res = loadIntentFile(rest[0] ?? fail({ error: 'usage: ibe intent validate <file>' }));
      if (!res.ok) fail({ valid: false, errors: res.error });
      print({
        valid: true,
        intent_id: res.value.contract.intent.id,
        hash: res.value.hash,
        warnings: res.value.warnings,
      });
      return;
    }
    case 'intent compat': {
      const v1 = loadStructuredFile(
        rest[0] ?? fail({ error: 'usage: ibe intent compat <v1-intent.json>' }),
      ) as IntentV1;
      const migrated = migrateV1ToV2(v1, { id: 'INT-COMPAT-001' });
      const res = validateIntent(migrated);
      if (!res.ok) fail({ valid: false, errors: res.error, migrated });
      print({ valid: true, migrated, hash: res.value.hash });
      return;
    }
    case 'model validate': {
      const res = loadModelFile(rest[0] ?? fail({ error: 'usage: ibe model validate <file>' }));
      if (!res.ok) fail({ valid: false, errors: res.error });
      print({
        valid: true,
        model_version: res.value.model.model_version,
        elements: res.value.model.elements.length,
      });
      return;
    }
    case 'model diff': {
      const a = loadModelFile(
        rest[0] ?? fail({ error: 'usage: ibe model diff <baseline> <proposed>' }),
      );
      const b = loadModelFile(
        rest[1] ?? fail({ error: 'usage: ibe model diff <baseline> <proposed>' }),
      );
      if (!a.ok) fail({ error: 'baseline invalid', errors: a.error });
      if (!b.ok) fail({ error: 'proposed invalid', errors: b.error });
      const delta = computeModelDelta(a.value, b.value);
      print(delta);
      return;
    }
    case 'hazards derive': {
      const model = rest[0] ? HazardModel.parse(loadStructuredFile(rest[0])) : IBE_SELF_HAZARDS;
      const integrity = validateHazardModel(model);
      if (integrity.length > 0) fail({ valid: false, errors: integrity });
      print({ name: model.name, controls: deriveControls(model) });
      return;
    }
    case 'policy evaluate': {
      const res = loadIntentFile(
        rest[0] ??
          fail({
            error:
              'usage: ibe policy evaluate <intent> <action> [--resource r --env e --approve id]',
          }),
      );
      if (!res.ok) fail({ error: 'intent invalid', errors: res.error });
      const action = rest[1] ?? fail({ error: 'missing action' });
      const engine = new DeterministicPolicyEngine();
      const ctx: PolicyContext = {
        now: Date.parse('2026-06-01T00:00:00.000Z'),
        actorId: 'builder-agent-04',
        builderId: 'builder-agent-04',
        intent: res.value.contract,
        intentHash: res.value.hash,
        request: {
          action,
          resource: flag(rest, 'resource', 'staging'),
          environment: flag(rest, 'env', 'staging'),
        },
        approvals: flags(rest, 'approve'),
      };
      const decision = engine.evaluate(ctx);
      if (decision.decision === 'deny') fail(decision);
      print(decision);
      return;
    }
    case 'capability issue': {
      const res = loadIntentFile(
        rest[0] ?? fail({ error: 'usage: ibe capability issue <intent> <action>' }),
      );
      if (!res.ok) fail({ error: 'intent invalid', errors: res.error });
      const action = rest[1] ?? fail({ error: 'missing action' });
      const idp = new LocalIdentityProvider();
      idp.register('broker-01', 'service', ['capability_broker']);
      idp.register('builder-agent-04', 'ai_agent', ['builder']);
      const broker = new CapabilityBroker(
        idp,
        'broker-01',
        new FixedClock('2026-06-01T00:00:00.000Z'),
      );
      const issued = broker.issue({
        intentId: res.value.contract.intent.id,
        intentHash: res.value.hash,
        actorId: 'builder-agent-04',
        action,
        resource: flag(rest, 'resource', 'staging'),
        environment: flag(rest, 'env', 'staging'),
        modelVersion: 'cli',
        ttlSeconds: 600,
        singleUse: true,
      });
      if (!issued.ok) fail({ error: 'issuance refused', reason: issued.error });
      print(issued.value);
      return;
    }
    case 'events validate': {
      const raw = loadStructuredFile(
        rest[0] ?? fail({ error: 'usage: ibe events validate <trace.json>' }),
      );
      const list = Array.isArray(raw) ? raw : ((raw as { events?: unknown[] }).events ?? []);
      const store = new EventStore();
      for (const e of list) store.append(parseEvent(e));
      const graph = new CausalGraph(store.all().slice());
      const structural = graph.validate();
      if (structural.length > 0) fail({ valid: false, structural });
      print({ valid: true, events: store.all().length, trace_root: digestOf(store.all()) });
      return;
    }
    case 'formal check': {
      const report = runFormalChecks();
      if (!report.ok) fail({ ok: false, report });
      print({
        ok: true,
        models: report.results.map((r) => ({
          model: r.model,
          expected: r.expected,
          statesExplored: r.statesExplored,
          pass: r.pass,
        })),
      });
      return;
    }
    case 'assurance verify': {
      const cert = loadStructuredFile(
        rest[0] ?? fail({ error: 'usage: ibe assurance verify <cert.json> [--keyring k.json]' }),
      ) as Certificate;
      const keyringPath = flag(
        rest,
        'keyring',
        join(OUT_DIR, `${(cert as { intent_id?: string }).intent_id ?? 'demo'}.keyring.json`),
      );
      if (!existsSync(keyringPath)) fail({ error: `keyring not found: ${keyringPath}` });
      const keyring = loadStructuredFile(keyringPath) as Record<string, string>;
      const idp = new LocalIdentityProvider();
      for (const [id, pem] of Object.entries(keyring))
        idp.registerPublicKey(id, 'service', ['signer'], pem);
      const reasons = verifyCertificate(cert, idp);
      if (reasons.length > 0) fail({ valid: false, decision: cert.decision, reasons });
      print({ valid: true, decision: cert.decision, id: cert.id, intent_id: cert.intent_id });
      return;
    }
    case 'demo run': {
      ensureDir(OUT_DIR);
      const { runAllDemos } = await import('../../examples/run-all.js');
      const summary = await runAllDemos(OUT_DIR);
      print(summary);
      if (!summary.ok) process.exit(1);
      return;
    }
    case 'oscal export': {
      ensureDir(OUT_DIR);
      const { runTerraformDemo } = await import('../../examples/terraform-azure/demo.js');
      const { exportForResult } = await import('../../examples/terraform-azure/oscal.js');
      const result = await runTerraformDemo();
      const oscal = exportForResult(result);
      const path = join(OUT_DIR, 'terraform-azure.oscal.json');
      writeFileSync(path, JSON.stringify(oscal, null, 2));
      print({ written: path, decision: result.decision });
      return;
    }
    default:
      print({
        error: 'unknown command',
        usage: [
          'ibe intent validate <file>',
          'ibe intent compat <v1-intent.json>',
          'ibe model validate <file>',
          'ibe model diff <baseline> <proposed>',
          'ibe hazards derive [file]',
          'ibe policy evaluate <intent> <action> [--resource r --env e --approve id]',
          'ibe capability issue <intent> <action>',
          'ibe events validate <trace.json>',
          'ibe formal check',
          'ibe assurance verify <cert.json> [--keyring k.json]',
          'ibe oscal export',
          'ibe demo run',
        ],
      });
      process.exit(2);
  }
}

main().catch((e) => {
  fail({ error: 'unexpected', message: e instanceof Error ? e.message : String(e) });
});
