/**
 * A fixed interval with a deadline: ask something every N seconds until it answers, or until the
 * deadline says the wait is over. What a `bash until` wait is.
 *
 * The monitor this replaced kept its own re-armed timer inside the process, so a restart ended
 * every wait the agent had started — the check was a command, but its schedule lived nowhere but
 * in memory. As a kind the schedule is the row: a restart resumes it where it was.
 *
 * The first poll is due at once: the thing being waited for may already have happened (a
 * pipeline that finished while the agent was thinking), and a first-interval delay would spend
 * the interval learning that. The deadline is a due time of its own, so a wait whose interval
 * does not divide it still ends ON the deadline rather than up to an interval after it.
 */
import type { TriggerKind } from '../contracts'

export interface PollSpec {
  everySeconds: number
  /** ISO time the wait gives up; null for a wait with no deadline. */
  expiresAt: string | null
}

export function pollSpec(spec: Record<string, unknown>): PollSpec {
  return {
    everySeconds: typeof spec.everySeconds === 'number' ? Math.max(1, spec.everySeconds) : 30,
    expiresAt: typeof spec.expiresAt === 'string' ? spec.expiresAt : null,
  }
}

/** True once the wait's deadline has come. */
export function pollExpired(spec: Record<string, unknown>, now: Date): boolean {
  const { expiresAt } = pollSpec(spec)
  return expiresAt !== null && Date.parse(expiresAt) <= now.getTime()
}

export const pollKind: TriggerKind = {
  id: 'poll',
  clock: 'time',
  onRestart: 'resume',
  firstDue: (_spec, now) => now,
  nextDue: (spec, now) => {
    const { everySeconds, expiresAt } = pollSpec(spec)
    const next = now.getTime() + everySeconds * 1000
    return new Date(expiresAt === null ? next : Math.min(next, Date.parse(expiresAt)))
  },
  // A poll's action is never gated (news waits in the wake queue, not here), and it counts its
  // own failing checks: a check that cannot run ends the wait, which a backoff would only delay.
  onGated: 'hold',
  backsOff: false,
}
