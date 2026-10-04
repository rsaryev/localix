/**
 * What happens when a monitor SPEAKS — a poll saw something, a watched line arrived, the watch
 * ended: redact, count, log, show, wake.
 *
 * One module because the path has one rule that must hold for every future addition: text coming
 * out of a check or a watched process is redacted at the SINGLE point where it becomes ours. A
 * monitor's wake is persisted as a message and its log is readable by the model, so a value
 * echoed by an authenticated check (`curl -v`, a service reflecting a token in an error body)
 * would otherwise settle in the database. Everything downstream of the shield is here, so a later
 * consumer cannot be added upstream of it by accident.
 *
 * The rules it owns beside that one:
 *   - the wake goes through the trigger's delivery with the FIRE's key, so a retried fire is the
 *     same delivery, not a second turn;
 *   - a monitor the USER stopped does not wake the agent — they are right there, and spending a
 *     turn to tell the agent what the person just did is noise. Every other ending is news;
 *   - the card is written by the tool that started the watch while that process lives; after a
 *     restart that writer is gone, and the ending settles the work and its item directly.
 */
import { createBoundedOutput, type BoundedOutput } from '../agent-core/tools/bash/bash-output'
import type { FireOutcome, TriggerRecord } from '../triggers/contracts'
import { fireOutcomeOf, triggerWake, type WakeOutcome, type WakeShape } from '../triggers/delivery'
import type { WorkRecord } from '../work/contracts'
import type { WorkRegistry } from '../work/registry'
import {
  formatMonitorWake,
  monitorWorkStatus,
  type MonitorEndReason,
  type MonitorEvent,
} from './contracts'
import { monitorPayload } from './record'

/** The starting tool's hooks onto its own transcript card, while it lives. */
export interface MonitorHooks {
  onEvents?: (events: MonitorEvent[]) => void
  onEnd?: (reason: MonitorEndReason, detail: string | undefined) => void
}

export interface MonitorReportDeps {
  work: Pick<WorkRegistry, 'recordEvents' | 'end'>
  /** The one wake path (`triggers/delivery`). */
  deliver: (request: WakeShape<'bg-monitor'>) => Promise<WakeOutcome>
  /** Redact known secret values. Absent ⇒ no shield is wired (tests, hosts without a vault). */
  shield?: (userId: string, text: string) => string
  /** A card whose live writer died with the old process: settle its item to this ended work. */
  settleItem?: (record: WorkRecord, reason: MonitorEndReason) => void
}

export function createMonitorReport(deps: MonitorReportDeps) {
  const hooks = new Map<string, MonitorHooks>()
  const logs = new Map<string, BoundedOutput>()
  const logKey = (trigger: Pick<TriggerRecord, 'sessionId' | 'payload'>) =>
    `${trigger.sessionId}:${monitorPayload(trigger).displayId}`

  const safe = (trigger: TriggerRecord, text: string) =>
    deps.shield ? deps.shield(trigger.userId, text) : text

  /** Shield, count and log — what every report does before it is shown or delivered. */
  const absorb = (trigger: TriggerRecord, raw: readonly MonitorEvent[]): MonitorEvent[] => {
    const events = raw.map((event) => ({ ...event, text: safe(trigger, event.text) }))
    if (events.length === 0) return events
    deps.work.recordEvents(monitorPayload(trigger).toolCallId, events)
    const key = logKey(trigger)
    const log = logs.get(key) ?? createBoundedOutput()
    logs.set(key, log)
    for (const event of events) log.append(`${event.text}\n`)
    return events
  }

  const wake = async (
    trigger: TriggerRecord,
    content: string,
    deliveryKey: string,
  ): Promise<FireOutcome> =>
    fireOutcomeOf(
      await deps.deliver(triggerWake(trigger, { content, source: 'bg-monitor', deliveryKey })),
    )

  return {
    /** The starting tool's card hooks, for as long as its process runs the monitor. */
    attach(triggerId: string, cardHooks: MonitorHooks): void {
      hooks.set(triggerId, cardHooks)
    },

    /** New events on a monitor that keeps watching. */
    async events(
      trigger: TriggerRecord,
      raw: readonly MonitorEvent[],
      deliveryKey: string,
    ): Promise<FireOutcome> {
      const events = absorb(trigger, raw)
      if (events.length === 0) return { ok: true }
      hooks.get(trigger.id)?.onEvents?.(events)
      const { displayId, description } = monitorPayload(trigger)
      return wake(
        trigger,
        formatMonitorWake({ monitorId: displayId, description, events }),
        deliveryKey,
      )
    },

    /**
     * The monitor's single ending, carrying the events that were still pending when it came.
     * `deliveryKey` is null when nothing should wake (a stop, a session going away).
     */
    async ended(
      trigger: TriggerRecord,
      ending: { reason: MonitorEndReason; detail?: string; events?: readonly MonitorEvent[] },
      deliveryKey: string | null,
    ): Promise<FireOutcome> {
      const events = absorb(trigger, ending.events ?? [])
      const detail = ending.detail === undefined ? undefined : safe(trigger, ending.detail)
      const payload = monitorPayload(trigger)
      const card = hooks.get(trigger.id)
      // Its log goes with it: `jobs` reads RUNNING work only, and the wake below carries the lines.
      hooks.delete(trigger.id)
      logs.delete(logKey(trigger))
      if (card?.onEnd) card.onEnd(ending.reason, detail)
      else {
        const record = deps.work.end(payload.toolCallId, {
          status: monitorWorkStatus(ending.reason),
        })
        if (record) deps.settleItem?.(record, ending.reason)
      }
      if (ending.reason === 'killed' || deliveryKey === null) return { ok: true }
      const content = formatMonitorWake({
        monitorId: payload.displayId,
        description: payload.description,
        events,
        ended: { reason: ending.reason, ...(detail ? { detail } : {}) },
      })
      return wake(trigger, content, deliveryKey)
    },

    /** Recent events for `jobs action="read"` — a monitor has no PTY scrollback. */
    log(sessionId: string, displayId: string): string | null {
      return logs.get(`${sessionId}:${displayId}`)?.text() ?? null
    },

    forget(trigger: Pick<TriggerRecord, 'id' | 'sessionId' | 'payload'>): void {
      hooks.delete(trigger.id)
      logs.delete(logKey(trigger))
    },
  }
}

export type MonitorReport = ReturnType<typeof createMonitorReport>
