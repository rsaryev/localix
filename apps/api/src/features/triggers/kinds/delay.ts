/**
 * A self-paced cadence: the agent sets the next delay after each fire.
 *
 * It used to go idle on firing and wait for the agent's `reschedule`, which parked it FOREVER in
 * three ordinary cases — the fire failed, the process restarted mid-fire, or the agent simply
 * forgot — with nothing saying so. So a fire now arms a WATCHDOG at the same delay again, and a
 * `reschedule` overwrites it. One mechanism covers all three: a trigger the agent did not pace
 * comes back at its last pace, and one it wants gone it removes.
 *
 * An occurrence the session could not take is HELD, not skipped: the agent asked for one run after
 * the delay, and that run is still owed when the session frees up.
 */
import type { TriggerKind } from '../contracts'

/** The agent's chosen delay is clamped to this window (seconds). */
export const DELAY_MIN_SECONDS = 60
export const DELAY_MAX_SECONDS = 3600

export function clampDelaySeconds(seconds: number): number {
  return Math.min(DELAY_MAX_SECONDS, Math.max(DELAY_MIN_SECONDS, Math.round(seconds)))
}

/** The spec's delay, or the longest one for a trigger that has not been paced yet. */
export function delaySeconds(spec: Record<string, unknown>): number {
  return typeof spec.delaySeconds === 'number'
    ? clampDelaySeconds(spec.delaySeconds)
    : DELAY_MAX_SECONDS
}

const after = (now: Date, spec: Record<string, unknown>) =>
  new Date(now.getTime() + delaySeconds(spec) * 1000)

export const delayKind: TriggerKind = {
  id: 'delay',
  clock: 'time',
  onRestart: 'resume',
  firstDue: (spec, now) => after(now, spec),
  nextDue: (spec, now) => after(now, spec),
  onGated: 'hold',
  backsOff: false,
}
