/**
 * A monitor, as the trigger that carries it: what the `monitor` action reads from a payload, and
 * the one place that writes one.
 *
 * The monitor service used to hold every watch in a process-wide map — ids, counters, status —
 * so a restart ended them all and the next process had no record that they existed. Now a
 * monitor is two durable rows, each answering its own question: the TRIGGER (when it fires, and
 * with what: this payload) and the WORK record (that it runs, what it has seen, how it ended).
 * Neither copies the other; the payload names its work by the tool call that started it.
 */
import type { TriggerRecord } from '../triggers/contracts'
import type { MonitorCondition, MonitorEmit, MonitorMode } from './contracts'

export const MONITOR_ACTION = 'monitor'

export interface MonitorPayload {
  mode: MonitorMode
  /** The agent's own words for it — every wake and the composer row show them. */
  description: string
  /**
   * The command being watched or polled, as WRITTEN: `${secret:KEY}` references stay intact.
   * The resolved value exists only in the spawned process's environment.
   */
  command: string
  cwd: string
  pathPrefix?: string[]
  /** Vault keys the command references — shown, because a watch using a credential must say so. */
  secretKeys?: string[]
  /** `until` mode's predicate and report policy. */
  when?: MonitorCondition
  emit?: MonitorEmit
  /** The work this monitor is: its `mon-N`, and the tool call whose card shows it. */
  displayId: string
  toolCallId: string
}

export function monitorPayload(trigger: Pick<TriggerRecord, 'payload'>): MonitorPayload {
  const p = trigger.payload
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  const strings = (value: unknown): string[] | undefined =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined
  return {
    mode: p.mode === 'watch' ? 'watch' : 'until',
    description: text(p.description),
    command: text(p.command),
    cwd: text(p.cwd),
    ...(strings(p.pathPrefix) ? { pathPrefix: strings(p.pathPrefix) } : {}),
    ...(strings(p.secretKeys)?.length ? { secretKeys: strings(p.secretKeys) } : {}),
    ...(p.when && typeof p.when === 'object' ? { when: p.when as MonitorCondition } : {}),
    ...(typeof p.emit === 'string' ? { emit: p.emit as MonitorEmit } : {}),
    displayId: text(p.displayId),
    toolCallId: text(p.toolCallId),
  }
}

/** What the composer row and `jobs` call it: the description, and any credential it uses. */
export function monitorLabel(payload: Pick<MonitorPayload, 'description' | 'secretKeys'>): string {
  return payload.secretKeys?.length
    ? `${payload.description} · uses Vault: ${payload.secretKeys.join(', ')}`
    : payload.description
}
