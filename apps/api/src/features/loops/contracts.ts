import type { SessionLoopSummary } from '../chat/contracts'
import type { LoopHandoff } from './handoff'

/** A loop either fires on a fixed cron cadence, or self-paces (the agent picks the next delay). */
export type LoopKind = 'fixed' | 'dynamic'

/**
 * Where a fire runs: 'session' injects the prompt into the owning session;
 * 'subsession' runs EVERY fire in a freshly created child session (the parent
 * only receives the child's summary when it finishes — its own history stays flat).
 */
export type LoopTarget = 'session' | 'subsession'

/** Outcome of the most recent fire. */
export type LoopRunStatus = 'ok' | 'error'

/** Dynamic loops clamp the agent-chosen delay to this window — the delay kind owns it. */
export {
  DELAY_MAX_SECONDS as DYNAMIC_MAX_DELAY_SECONDS,
  DELAY_MIN_SECONDS as DYNAMIC_MIN_DELAY_SECONDS,
} from '../triggers/kinds/delay'

/**
 * What delivering one fire reported. `ok` means the wake was delivered (session fire: its run
 * ended; subsession fire: the child run finished).
 */
export interface LoopFireOutcome {
  ok: boolean
  error?: string
  /** What a subsession round reported for the next one. Absent when it reported nothing. */
  handoff?: LoopHandoff
  /**
   * The fire was DECLINED, not attempted — a subsession loop whose previous child still runs.
   * Neither a failure (a loop slower than its cadence is healthy) nor a count toward the backoff.
   */
  skipped?: true
}

/**
 * The effective prompt for a maintenance loop (no explicit task). Self-contained —
 * no `.claude/loop.md` lookup; a server with a DB keeps the playbook in the loop row.
 */
export const LOOP_MAINTENANCE_PROMPT = `Scheduled maintenance loop iteration.

- Continue any unfinished work from this conversation.
- Tend to the current branch's pull request: review comments, failed CI runs, merge conflicts.
- When nothing else is pending, run a small cleanup pass such as a bug hunt or a simplification.

Do not start new initiatives outside that scope. Irreversible actions such as pushing or
deleting only proceed when they continue something the transcript already authorized.`

/** One active loop: the loop's view of a `loop` trigger (`./record`). */
export interface SessionLoop {
  id: string
  userId: string
  sessionId: string
  /** The participant that armed it — the one its fires are addressed to. Absent for a person's. */
  ownerAgentId?: string
  kind: LoopKind
  /** Fixed loops only: the 5-field cron cadence. `null` for dynamic loops. */
  cron: string | null
  /** The effective prompt run on each fire (the maintenance prompt for maintenance loops). */
  prompt: string
  /** True when this loop has no explicit task and runs the maintenance routine. */
  maintenance: boolean
  /**
   * What the previous SUBSESSION round handed to the next one. Absent before the first
   * round, and whenever a round declined to report — the loop keeps running, it just
   * inherits nothing. Session-target loops never set it: they keep their own transcript.
   */
  handoff?: LoopHandoff
  /** Dynamic loops: the last delay (seconds) the agent chose — for display only. */
  delaySeconds?: number
  createdAt: string
  /**
   * ISO timestamp of the next fire. Never absent: a dynamic loop is not left idle awaiting its
   * reschedule any more — each fire arms a watchdog at its last delay (`triggers/kinds/delay`).
   * While the session is busy this is the occurrence still owed, possibly already past.
   */
  nextRunAt: string
  /** Where fires run. Default 'session'. */
  target: LoopTarget
  /** Most recent fire (null before the first). */
  lastRunAt: string | null
  /** Outcome of the most recent fire (null before the first). */
  lastStatus: LoopRunStatus | null
  /** Error detail when `lastStatus` is 'error'. */
  lastError: string | null
  /** Total fires so far. */
  runCount: number
  /**
   * ISO time the engine holds this occurrence until because the addressed participant's provider
   * route is exhausted — the trigger's own persisted `rate-limited` hold, not a guess from a
   * cooldown. Read off the hold because the gate is what decides whose route a fire takes: a
   * read of the session's cooldowns would claim a hold for a participant whose own route is
   * fine, and for an occurrence not yet due (a hold is per occurrence — the gate runs only once
   * it is). It also survives a restart with the hold itself. Absent when nothing holds it.
   */
  heldUntil?: string
}

/** Public summary shape for the UI / session detail. Single source so callers don't drift. */
export function toLoopSummary(l: SessionLoop): SessionLoopSummary {
  return {
    ...(l.heldUntil ? { heldUntil: l.heldUntil } : {}),
    id: l.id,
    kind: l.kind,
    cron: l.cron,
    prompt: l.prompt,
    maintenance: l.maintenance,
    delaySeconds: l.delaySeconds,
    nextRunAt: l.nextRunAt,
    createdAt: l.createdAt,
    target: l.target,
    lastRunAt: l.lastRunAt,
    lastStatus: l.lastStatus,
    runCount: l.runCount,
  }
}
