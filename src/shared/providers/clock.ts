/**
 * Clock abstraction for item 0005.
 *
 * Real implementation delegates to Date.now(). The fake is controllable:
 * tests advance time explicitly so cadence logic never depends on wall-clock
 * timing (principle #11 — deterministic tests).
 */

export interface Clock {
  /** Returns the current time in milliseconds. */
  now(): number
}

// ---------------------------------------------------------------------------
// Real clock — thin wrapper around Date.now()
// ---------------------------------------------------------------------------

export class RealClock implements Clock {
  now(): number {
    return Date.now()
  }
}

// ---------------------------------------------------------------------------
// Fake clock — time only moves when the test tells it to
// ---------------------------------------------------------------------------

export class FakeClock implements Clock {
  private _now: number

  constructor(startMs = 0) {
    this._now = startMs
  }

  now(): number {
    return this._now
  }

  /** Advance the clock by `deltaMs` milliseconds. */
  tick(deltaMs: number): void {
    this._now += deltaMs
  }

  /** Jump the clock to an explicit timestamp. */
  setNow(ms: number): void {
    this._now = ms
  }
}
