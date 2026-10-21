/**
 * MONITOR contracts — the vocabulary of an event-driven wait, and the ONE owner of the
 * text a monitor wakes the agent with.
 *
 * A monitor is a background watch that decides WHEN the agent should think again. Two
 * shapes, one engine:
 *
 *   - `watch`  — a long-lived command whose every stdout LINE is an event (`tail -f`,
 *                a CI poll loop the agent wrote, `inotifywait -m`).
 *   - `until`  — a CONDITION: run `check` every interval and fire when the predicate
 *                holds ("pipeline reached a terminal status", "the service answers 200",
 *                "the temperature is ≥ 35"). This is the half that removes the
 *                hand-written diff loop — the agent states the condition, not the
 *                bookkeeping around it.
 *
 * Pure module: no processes, and its one import is the pure wait vocabulary. Everything here is
 * data + formatting, so the wake wording has one home and cannot drift per caller (the mistake
 * `wake-provenance.ts` was created to undo). A running monitor is a trigger (`./record`) plus a work record; neither is shaped here.
 */
import { monitorEndPhrase } from '../agent-core/tools/bash/monitor-wait'

/** Which shape a monitor is. `watch` streams lines; `until` polls for a predicate. */
export type MonitorMode = 'watch' | 'until'

/**
 * How often an `until` monitor is allowed to report.
 *   - `once`      → fire the first time the predicate holds, then END (the default: a wait
 *                   is over when the thing it waited for happened).
 *   - `on_change` → fire whenever the check's output CHANGES (pipeline step transitions).
 *   - `every`     → fire on every poll where the predicate holds (rare; rate-limited).
 */
export type MonitorEmit = 'once' | 'on_change' | 'every'

/** Why a monitor is no longer watching. */
export type MonitorEndReason =
  | 'condition-met'
  | 'exited'
  | 'timeout'
  | 'killed'
  | 'rate-limited'
  | 'error'
  /** The server restarted under a watch whose process it owned. */
  | 'restart'

/** Numeric comparison for an `until` predicate. Any combination; all supplied bounds must hold. */
export interface MonitorNumberBound {
  gte?: number
  lte?: number
  eq?: number
}

/**
 * The predicate an `until` monitor evaluates against one poll of `check`.
 *
 * Deliberately a small, closed set. Everything richer belongs INSIDE the check command
 * (`jq`, `grep -c`), where the user's own tools already live — a monitor that grew an
 * expression language would be re-implementing the shell it already runs.
 */
export type MonitorCondition =
  | { kind: 'exit_zero' }
  | { kind: 'contains'; value: string }
  | { kind: 'not_contains'; value: string }
  | { kind: 'regex'; value: string }
  | { kind: 'number'; bound: MonitorNumberBound; jsonPath?: string }

/** The `until` half of a spec, already normalized (interval clamped, emit defaulted). */
export interface MonitorUntilSpec {
  check: string
  everySeconds: number
  when: MonitorCondition
  emit: MonitorEmit
}

/** A validated, host-independent monitor request. */
export interface MonitorSpec {
  /** Shown in every wake and in the composer strip. The agent's own words. */
  description: string
  cwd: string
  /** `watch` mode: the command whose stdout lines are events. */
  watch?: string
  /** `until` mode: the polled predicate. */
  until?: MonitorUntilSpec
  /** Deadline in ms, or `null` for a session-length (persistent) watch. */
  timeoutMs: number | null
  /** Extra PATH entries (enabled plugins' `bin/`), forwarded to the spawner. */
  pathPrefix?: string[]
}

/** One thing worth waking the agent for. */
export interface MonitorEvent {
  at: number
  text: string
}

/** Concurrent monitors one session may hold. A wait needs a handful; a hundred is a bug. */
export const MONITOR_MAX_PER_SESSION = 4
/** Event lines carried in ONE wake. The rest stay on the tool card / `jobs read`. */
export const MONITOR_WAKE_MAX_LINES = 20

/** How the work record of a monitor that ended this way reads. */
export function monitorWorkStatus(
  reason: MonitorEndReason,
): 'succeeded' | 'cancelled' | 'timed-out' | 'failed' | 'lost' {
  switch (reason) {
    case 'condition-met':
      return 'succeeded'
    case 'killed':
      return 'cancelled'
    case 'timeout':
      return 'timed-out'
    case 'restart':
      return 'lost'
    case 'exited':
    case 'rate-limited':
    case 'error':
      return 'failed'
  }
}

/**
 * The wake body. One owner, because this text is the agent's ENTIRE view of the event:
 * it must name the monitor (so a session with several can tell them apart), carry the
 * lines, and say what to do next — act, then end the turn. A monitor that is still
 * watching must NOT read as "go poll me".
 */
export function formatMonitorWake(input: {
  monitorId: string
  description: string
  events: readonly MonitorEvent[]
  ended?: { reason: MonitorEndReason; detail?: string }
}): string {
  const lines = input.events.map((event) => event.text)
  const shown = lines.slice(0, MONITOR_WAKE_MAX_LINES)
  const hidden = lines.length - shown.length
  const body = [
    ...shown,
    // A monitor that ended is no longer running work, so `jobs` cannot read it any more.
    ...(hidden > 0
      ? [
          `… ${hidden} more event${hidden === 1 ? '' : 's'}${input.ended ? '' : ` (read them with jobs action="read" job_id="${input.monitorId}")`}`,
        ]
      : []),
  ]
  if (input.ended) {
    const detail = input.ended.detail ? ` — ${input.ended.detail}` : ''
    return [
      `[Monitor ${input.monitorId} ended: ${input.description}] ${monitorEndPhrase(input.ended.reason)}${detail}`,
      ...body,
      'This wait is over: nothing will wake you for it again. Continue, or start a new `bash until` wait if you still need to.',
    ]
      .filter(Boolean)
      .join('\n')
  }
  const count = input.events.length
  return [
    `[Monitor ${input.monitorId}: ${input.description}] ${count} new event${count === 1 ? '' : 's'}`,
    ...body,
    `Still watching. Act on this, then END your turn — the next event wakes you again. Stop it with jobs action="stop" job_id="${input.monitorId}" once it is no longer useful.`,
  ].join('\n')
}
