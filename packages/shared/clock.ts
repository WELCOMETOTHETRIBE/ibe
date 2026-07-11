/**
 * Injectable clock. Determinism matters for the assurance kernel: capability
 * expiry, evidence freshness, and certificate timestamps must be reproducible
 * under test and auditable in production. Production code uses SystemClock;
 * tests use FixedClock.
 */

export interface Clock {
  /** Milliseconds since epoch. */
  now(): number;
  /** ISO-8601 string for the current instant. */
  nowIso(): string;
}

export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
  nowIso(): string {
    return new Date(this.now()).toISOString();
  }
}

export class FixedClock implements Clock {
  private current: number;
  constructor(startIso: string | number = '2026-01-01T00:00:00.000Z') {
    this.current = typeof startIso === 'number' ? startIso : Date.parse(startIso);
  }
  now(): number {
    return this.current;
  }
  nowIso(): string {
    return new Date(this.current).toISOString();
  }
  /** Advance the clock (test helper). */
  advance(ms: number): void {
    this.current += ms;
  }
  set(iso: string): void {
    this.current = Date.parse(iso);
  }
}

export const systemClock = new SystemClock();
