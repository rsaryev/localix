/**
 * The vocabulary of endpoint liveness, kept apart from any probe or scheduler so a
 * consumer can describe WHAT it watches without naming HOW it is checked.
 */

/** Something whose availability can be asked about. */
export type LivenessTarget =
  | { kind: 'tcp'; host: string; port: number }
  | { kind: 'unix'; path: string }
  /** An origin/URL — resolved to a TCP target, or probed over HTTP when `expectResponse`. */
  | { kind: 'url'; url: string; expectResponse?: boolean }
  /** Availability nobody can probe: the owner reports it (a process exit, a closed server). */
  | { kind: 'reported' }
  | { kind: 'custom'; probe: Probe }

/** One check. Resolves true (available) or false; it must never reject. */
export type Probe = (signal: AbortSignal) => Promise<boolean>

/** Where the current answer came from — a caller shows "unknown" differently from "down". */
export type LivenessSource = 'probe' | 'report' | 'unknown'

export interface LivenessState {
  /** Undefined until the first answer: not yet asked is not the same as not alive. */
  alive: boolean | undefined
  source: LivenessSource
  /** When `alive` last CHANGED (or was first learned). */
  since: number
  /** When it was last confirmed, by a probe or a report. */
  checkedAt: number
  /** Consecutive probe outcomes contradicting the published state — the threshold counter. */
  pending: number
}

/**
 * Scheduling and anti-flap policy, in Kubernetes probe vocabulary (`periodSeconds`,
 * `timeoutSeconds`, `failureThreshold`, `successThreshold`) because that is the naming
 * every operator already knows for exactly this problem.
 */
export interface LivenessPolicy {
  /** Per-probe budget. A TCP connect to a loopback dev server answers in ~1 ms; 300 ms is
   *  wait-on's default for the same check and leaves room for a busy machine. */
  timeoutMs: number
  /** Floor between probes. */
  periodMs: number
  /** Ceiling, so a slow probe or a long-dead endpoint cannot creep into a busy loop. */
  maxPeriodMs: number
  /**
   * The measured cost multiplier: the next delay is at least `average probe ms × this`, so
   * the watcher spends a bounded fraction of the machine no matter how slow probing is.
   * The default of 20 bounds the watcher to about 5% of the time.
   */
  costFactor: number
  /** Consecutive failures before a live endpoint is published as down. */
  failureThreshold: number
  /** Consecutive successes before a down endpoint is published as up. */
  successThreshold: number
}

export const DEFAULT_LIVENESS_POLICY: LivenessPolicy = {
  timeoutMs: 300,
  periodMs: 2_000,
  maxPeriodMs: 30_000,
  costFactor: 20,
  failureThreshold: 2,
  successThreshold: 1,
}

export type LivenessListener = (state: LivenessState) => void
