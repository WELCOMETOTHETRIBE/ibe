/**
 * Runs all three vertical-slice demos, persists their signed certificates,
 * evidence, event traces, and public keyrings under evidence/generated/, and
 * returns a summary. Each demo is expected to REFUSE (they encode the
 * intentionally-unsafe proposals from §24). The summary `ok` is true only if
 * every demo produced the expected decision AND its certificate re-verifies.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalIdentityProvider } from '../packages/identity/index.js';
import { verifyCertificate } from '../packages/assurance/index.js';
import type { PipelineResult } from '../packages/orchestrator/index.js';
import { runRateLimiterDemo } from './rate-limiter/demo.js';
import { runGithubChangeDemo } from './github-change/demo.js';
import { runTerraformDemo } from './terraform-azure/demo.js';
import { exportForResult } from './terraform-azure/oscal.js';

interface DemoSpec {
  name: string;
  run: () => Promise<PipelineResult>;
  expected: 'accepted' | 'refused';
}

const DEMOS: DemoSpec[] = [
  { name: 'rate-limiter', run: runRateLimiterDemo, expected: 'refused' },
  { name: 'github-change', run: runGithubChangeDemo, expected: 'refused' },
  { name: 'terraform-azure', run: runTerraformDemo, expected: 'refused' },
];

export interface DemoSummary {
  ok: boolean;
  demos: Array<{
    name: string;
    decision: string;
    expected: string;
    asExpected: boolean;
    certificateVerified: boolean;
    failedGates: string[];
    topReasons: string[];
    certificatePath: string;
  }>;
}

export async function runAllDemos(outDir: string): Promise<DemoSummary> {
  const demos: DemoSummary['demos'] = [];

  for (const spec of DEMOS) {
    const result = await spec.run();

    // Persist artifacts.
    const certPath = join(outDir, `${spec.name}.certificate.json`);
    writeFileSync(certPath, JSON.stringify(result.certificate, null, 2));
    writeFileSync(join(outDir, `${spec.name}.events.json`), JSON.stringify(result.events, null, 2));
    writeFileSync(
      join(outDir, `${spec.name}.evidence.json`),
      JSON.stringify(result.evidence, null, 2),
    );
    writeFileSync(
      join(outDir, `${result.certificate.intent_id}.keyring.json`),
      JSON.stringify(result.keyring, null, 2),
    );
    if (spec.name === 'terraform-azure') {
      writeFileSync(
        join(outDir, `${spec.name}.oscal.json`),
        JSON.stringify(exportForResult(result), null, 2),
      );
    }

    // Re-verify the certificate from its persisted keyring (independent check).
    const idp = new LocalIdentityProvider();
    for (const [id, pem] of Object.entries(result.keyring))
      idp.registerPublicKey(id, 'service', ['signer'], pem);
    const verifyReasons = verifyCertificate(result.certificate, idp);

    demos.push({
      name: spec.name,
      decision: result.decision,
      expected: spec.expected,
      asExpected: result.decision === spec.expected,
      certificateVerified: verifyReasons.length === 0,
      failedGates: result.gates.filter((g) => !g.passed).map((g) => g.id),
      topReasons: result.reasons.slice(0, 4).map((r) => `${r.code}: ${r.message}`),
      certificatePath: certPath,
    });
  }

  const ok = demos.every((d) => d.asExpected && d.certificateVerified);
  return { ok, demos };
}
