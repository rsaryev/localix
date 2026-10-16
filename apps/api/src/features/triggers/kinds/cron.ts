/**
 * A fixed cadence: a 5-field cron in the zone it was written in.
 *
 * A slot is a moment. An occurrence that could not be delivered (the session was busy) is given up
 * rather than fired late, because a late fire is a different occurrence and a queue of them would
 * replay the whole busy stretch at once. For the same reason a restart after a long downtime fires
 * at most ONE catch-up: the first evaluation finds the stored slot past due, fires it, and the next
 * slot is computed from now.
 */
import type { TriggerKind } from '../contracts'
import { nextCronSlot } from '../schedule'

export interface CronSpec {
  cron: string
  timeZone: string
}

export function cronSpec(spec: Record<string, unknown>): CronSpec {
  return { cron: String(spec.cron), timeZone: String(spec.timeZone) }
}

export const cronKind: TriggerKind = {
  id: 'cron',
  clock: 'time',
  onRestart: 'resume',
  firstDue: (spec, now) => nextCronSlot(cronSpec(spec).cron, now, cronSpec(spec).timeZone),
  nextDue: (spec, now) => nextCronSlot(cronSpec(spec).cron, now, cronSpec(spec).timeZone),
  onGated: 'skip',
  backsOff: true,
}
