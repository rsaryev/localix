/**
 * WHAT A MONITOR'S FIRE DOES — the `monitor` trigger action.
 *
 * Its kind decides when (`triggers/kinds/poll`: every N seconds until a deadline;
 * `triggers/kinds/stream`: when the watched process printed something); this decides what the
 * fire means:
 *
 *   poll    the deadline passed → the wait ends `timeout`; else run the check with the monitor's
 *           credentials, let `./poll-step` say what to report, and report it;
 *   stream  report the lines the process printed, or its ending;
 *   restart a stream's process died with the old server — one wake says so (`restarted`).
 *
 * Never gated. A monitor's event is NEWS, not a continuation: holding it because the agent is
 * mid-turn would lose the only notice that the thing it waited for happened. The wake queue is
 * the right owner of "later" — it holds the wake at wake priority and coalesces a burst.
 */
import type { FireOutcome, TriggerAction, TriggerRecord } from '../triggers/contracts'
import { pollExpired, pollSpec } from '../triggers/kinds/poll'
import type { MonitorEndReason, MonitorEvent } from './contracts'
import type { MonitorCredentials } from './credentials'
import { checkTimeoutMs, pollStateOf, pollStep } from './poll-step'
import { MONITOR_ACTION, monitorPayload } from './record'
import type { MonitorReport } from './report'
import type { CheckRun } from './sources'

/** What a stream's host reports through `TriggerEngine.emit`. */
export interface MonitorStreamEvent {
  events: MonitorEvent[]
  ended?: { reason: MonitorEndReason; detail?: string }
}

export interface MonitorActionDeps {
  report: MonitorReport
  credentials: MonitorCredentials
  runCheck: CheckRun
  /** False once the monitor was stopped — a check that finishes after a stop reports nothing. */
  isLive: (triggerId: string) => boolean
  now?: () => Date
}

export function createMonitorAction(deps: MonitorActionDeps): TriggerAction {
  const now = deps.now ?? (() => new Date())
  const { report } = deps

  const ending = async (
    trigger: TriggerRecord,
    end: { reason: MonitorEndReason; detail?: string; events?: MonitorEvent[] },
    deliveryKey: string,
    extra: Partial<FireOutcome> = {},
  ): Promise<FireOutcome> => ({
    ...(await report.ended(trigger, end, deliveryKey)),
    ...extra,
    end: end.reason,
  })

  const poll = async (trigger: TriggerRecord, deliveryKey: string): Promise<FireOutcome> => {
    const at = now()
    if (pollExpired(trigger.spec, at)) {
      const seconds = Math.round((at.getTime() - Date.parse(trigger.createdAt)) / 1000)
      return ending(
        trigger,
        { reason: 'timeout', detail: `no ending within ${seconds}s` },
        deliveryKey,
      )
    }
    const payload = monitorPayload(trigger)
    const credentials = await deps.credentials.forTrigger(trigger.id, trigger.userId, payload)
    if (!credentials.ok)
      return ending(trigger, { reason: 'error', detail: credentials.error }, deliveryKey)
    let sample
    try {
      sample = await deps.runCheck({
        command: credentials.executable,
        cwd: payload.cwd,
        timeoutMs: checkTimeoutMs(pollSpec(trigger.spec).everySeconds),
        ...(payload.pathPrefix ? { pathPrefix: payload.pathPrefix } : {}),
        ...(Object.keys(credentials.env).length > 0 ? { env: credentials.env } : {}),
      })
    } catch (error) {
      const detail = `check could not run: ${error instanceof Error ? error.message : String(error)}`
      return ending(trigger, { reason: 'error', detail }, deliveryKey)
    }
    // Stopped while the check ran: the person already knows, and the fire lands nowhere.
    if (!deps.isLive(trigger.id)) return { ok: true, skipped: true }
    const step = pollStep({
      sample,
      state: pollStateOf(trigger.payload),
      when: payload.when ?? { kind: 'exit_zero' },
      emit: payload.emit ?? 'once',
      check: payload.command,
    })
    const events = step.events.map((text) => ({ at: at.getTime(), text }))
    const kept = { payload: { poll: step.state } }
    if (step.end) return ending(trigger, { ...step.end, events }, deliveryKey, kept)
    return { ...(await report.events(trigger, events, deliveryKey)), ...kept }
  }

  return {
    id: MONITOR_ACTION,

    fire(trigger, { deliveryKey, event }) {
      if (!event) return poll(trigger, deliveryKey)
      const { events, ended } = event as unknown as MonitorStreamEvent
      return ended
        ? ending(trigger, { ...ended, events }, deliveryKey)
        : report.events(trigger, events, deliveryKey)
    },
  }
}
