/**
 * @ibe/api — a dependency-free REST service exposing the assurance kernel over
 * HTTP (§22). Endpoints fail closed: refusals return HTTP 422 with structured
 * reasons; malformed input returns 400. All request bodies are size-capped.
 *
 * This is a control-plane API, not a public web app. It performs no ambient
 * authorization of its own — every decision flows through the same deterministic
 * kernel the CLI uses.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { FixedClock, digestOf } from '../shared/index.js';
import { validateIntent } from '../intent/index.js';
import { validateModel, computeModelDelta } from '../model/index.js';
import { DeterministicPolicyEngine, type PolicyContext } from '../policy/index.js';
import { EventStore, parseEvent } from '../events/index.js';
import { CausalGraph } from '../causal/index.js';
import { runFormalChecks } from '../formal/index.js';
import { LocalIdentityProvider } from '../identity/index.js';
import { verifyCertificate, type Certificate } from '../assurance/index.js';
import { OPENAPI } from './openapi.js';

const MAX_BODY = 2 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'public, max-age=300',
  });
  res.end(html);
}

/** The self-contained demo UI (web/index.html), read once and cached. */
let uiCache: string | null = null;
function loadUi(): string {
  if (uiCache !== null) return uiCache;
  for (const p of [
    join(process.cwd(), 'web', 'index.html'),
    join(process.cwd(), '..', '..', '..', 'web', 'index.html'),
  ]) {
    if (existsSync(p)) {
      uiCache = readFileSync(p, 'utf-8');
      return uiCache;
    }
  }
  uiCache =
    '<!doctype html><meta charset="utf-8"><title>IBE</title><body style="font-family:monospace;background:#06070D;color:#F4F6FB;padding:40px">IBE control plane is running. UI asset not found; see <a style="color:#00E5FF" href="/openapi.json">/openapi.json</a>.</body>';
  return uiCache;
}

export function createIbeServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'GET /':
        case 'GET /index.html':
        case 'GET /ui':
          return sendHtml(res, 200, loadUi());
        case 'GET /health':
          return send(res, 200, { ok: true });
        case 'GET /openapi.json':
          return send(res, 200, OPENAPI);
        case 'GET /formal/check': {
          const report = runFormalChecks();
          return send(res, report.ok ? 200 : 422, report);
        }
        case 'POST /intents/validate': {
          const r = validateIntent(await readBody(req));
          return r.ok
            ? send(res, 200, {
                valid: true,
                intent_id: r.value.contract.intent.id,
                hash: r.value.hash,
              })
            : send(res, 422, { valid: false, errors: r.error });
        }
        case 'POST /models/validate': {
          const r = validateModel(await readBody(req));
          return r.ok
            ? send(res, 200, { valid: true, model_version: r.value.model.model_version })
            : send(res, 422, { valid: false, errors: r.error });
        }
        case 'POST /models/diff': {
          const body = (await readBody(req)) as { baseline?: unknown; proposed?: unknown };
          const a = validateModel(body.baseline);
          const b = validateModel(body.proposed);
          if (!a.ok || !b.ok) return send(res, 400, { error: 'invalid models' });
          return send(res, 200, computeModelDelta(a.value, b.value));
        }
        case 'POST /policy/evaluate': {
          const body = (await readBody(req)) as {
            intent?: unknown;
            action?: string;
            resource?: string;
            environment?: string;
            approvals?: string[];
          };
          const intent = validateIntent(body.intent);
          if (!intent.ok) return send(res, 400, { error: 'invalid intent', errors: intent.error });
          const ctx: PolicyContext = {
            now: new FixedClock('2026-06-01T00:00:00.000Z').now(),
            actorId: 'builder-agent-04',
            builderId: 'builder-agent-04',
            intent: intent.value.contract,
            intentHash: intent.value.hash,
            request: {
              action: body.action ?? '',
              resource: body.resource ?? 'staging',
              environment: body.environment ?? 'staging',
            },
            approvals: body.approvals ?? [],
          };
          const decision = new DeterministicPolicyEngine().evaluate(ctx);
          return send(res, decision.decision === 'allow' ? 200 : 422, decision);
        }
        case 'POST /events/validate': {
          const body = await readBody(req);
          const list = Array.isArray(body) ? body : ((body as { events?: unknown[] }).events ?? []);
          const store = new EventStore();
          for (const e of list) store.append(parseEvent(e));
          const structural = new CausalGraph(store.all().slice()).validate();
          return send(res, structural.length === 0 ? 200 : 422, {
            valid: structural.length === 0,
            structural,
            trace_root: digestOf(store.all()),
          });
        }
        case 'POST /assurance/verify': {
          const body = (await readBody(req)) as {
            certificate?: Certificate;
            keyring?: Record<string, string>;
          };
          if (!body.certificate || !body.keyring)
            return send(res, 400, { error: 'certificate and keyring required' });
          const idp = new LocalIdentityProvider();
          for (const [id, pem] of Object.entries(body.keyring))
            idp.registerPublicKey(id, 'service', ['signer'], pem);
          const reasons = verifyCertificate(body.certificate, idp);
          return send(res, reasons.length === 0 ? 200 : 422, {
            valid: reasons.length === 0,
            reasons,
          });
        }
        default:
          return send(res, 404, { error: 'not found', route, see: '/openapi.json' });
      }
    } catch (e) {
      return send(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  });
}

// Start when run directly.
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const port = Number(process.env.PORT ?? 8080);
  createIbeServer().listen(port, () => {
    process.stderr.write(`IBE API listening on :${port} (GET /openapi.json)\n`);
  });
}
