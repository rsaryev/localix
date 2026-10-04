/**
 * WHOSE QUOTA A SCHEDULED FIRE WOULD SPEND.
 *
 * A cooldown is keyed by provider route (`route-cooldowns.ts`), but a loop fire is addressed to
 * a PARTICIPANT, and participants of one conversation may run on different routes. Asking the
 * cooldown with the wrong participant's route is the defect this prevents in both directions:
 * the fire is held behind a route it will not use, or it is admitted into the exhausted route it
 * will.
 *
 * So the route asked about is the addressed participant's, read off the session's resolved party
 * (the same read the run's admission does, so both see one route). When there is no addressee —
 * a person's loop, or the participant that armed it has left — the conversation chooses the
 * speaker at delivery, which could be anyone in it. Holding then waits only while EVERY
 * participant is exhausted, until the first of them recovers: holding while one route is still
 * admitted would reintroduce the whole-conversation hold for the unaddressed case.
 */
import { agentRoute, type RoutableSession } from '../session-route'
import type { ProviderRoute } from './route-cooldowns'

export function addressedCooldownUntil(
  session: RoutableSession,
  addressedAgentId: string | undefined,
  untilOf: (route: ProviderRoute) => number | null,
): number | null {
  const addressed = addressedAgentId ? agentRoute(session, addressedAgentId) : undefined
  if (addressed) return untilOf(addressed)
  let earliest: number | null = null
  for (const route of session.agents) {
    const until = untilOf(route)
    if (until === null) return null
    earliest = earliest === null ? until : Math.min(earliest, until)
  }
  return earliest
}
