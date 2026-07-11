/**
 * Execution harness run INSIDE the runner (subprocess / container). It executes
 * the PATCHED rate limiter against a burst workload and writes observed metrics
 * to ./metrics.json (captured as an artifact) and to stdout. It never trusts the
 * implementation's claims — it records what actually happened at runtime.
 */

import { writeFileSync } from 'node:fs';
import { RateLimiter } from './target/patched.js';

function main(): void {
  const capacity = 10;
  const burst = 25; // more than capacity, with no time for refill
  const limiter = new RateLimiter({ capacity, refillRate: 5 }, () => 1000); // frozen clock

  let allowed = 0;
  let denied = 0;
  for (let i = 0; i < burst; i++) {
    if (limiter.allow('client-a')) allowed += 1;
    else denied += 1;
  }

  const metrics = { capacity, burst, allow_count: allowed, deny_count: denied };
  try {
    writeFileSync('metrics.json', JSON.stringify(metrics));
  } catch {
    /* workspace may be read-only in some runners; stdout is the source of truth */
  }
  process.stdout.write(JSON.stringify(metrics));
}

main();
