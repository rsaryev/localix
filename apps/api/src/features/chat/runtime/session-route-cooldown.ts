/**
 * WHOSE QUOTA A SCHEDULED FIRE WOULD SPEND.
 *
 * A cooldown is keyed by provider route (`route-cooldowns.ts`). A conversation has one agent and
 * so one route; a loop fire is held while that route is exhausted, and admitted otherwise. The
 * route is read off the session's resolved agent (the same read the run's admission does, so
 * both see one route).
 */
import { sessionRoute, type RoutableSession } from '../../../contracts/session-route'
import type { ProviderRoute } from './route-cooldowns'

export function sessionCooldownUntil(
  session: RoutableSession,
  untilOf: (route: ProviderRoute) => number | null,
): number | null {
  return untilOf(sessionRoute(session))
}
