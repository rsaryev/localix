/**
 * WHICH PROVIDER ROUTE HAS SPENT ITS ALLOWANCE, AND UNTIL WHEN.
 *
 * The defect this stops: the cooldown used to be keyed by SESSION, so in a conversation where
 * one agent runs on provider A and another on provider B, a 429 from A held every
 * scheduled fire of the conversation — B's agent sat idle behind a quota it never touched.
 * A quota belongs to what the request was billed against, not to the conversation it came from.
 *
 * So the key is the route the failed run took: its provider connection (the account and key)
 * plus its model. The shape follows the two routers that got this right — LiteLLM cools down a
 * DEPLOYMENT (model + credential, `router_utils/cooldown_handlers.py`), and Codex keeps rate-limit
 * state per backend bucket (`RateLimitSnapshot.limit_id`), neither per session. Two consequences
 * follow from keying by route rather than session, and both are intended:
 *
 *   - two agents on the SAME connection and model share one quota, so they share one hold;
 *   - the hold is process-wide: a 429 in one conversation holds a loop in another on that route,
 *     which would otherwise fire straight into the same exhausted allowance.
 *
 * Two widths, because the classifier separates two causes (`AgentErrorInfo.retryable`):
 *
 *   route       a transient 429 — providers meter per model, so the connection's other models
 *               are still admitted;
 *   connection  a spent plan or credit balance — the account itself is empty, so every model on
 *               that connection waits. Only when the route NAMES a connection: a blank connection
 *               would otherwise collapse every chain-resolved route into one key.
 *
 * In memory on purpose: a restart may be exactly when the quota has recovered, and a fire that
 * was already held carries its own persisted `next_due_at` (the trigger engine's hold).
 */

/** What a quota is billed against: the connection (account + key) and the model on it. */
export interface ProviderRoute {
  providerConnectionId: string | null
  modelId: string
}

export type CooldownWidth = 'route' | 'connection'

export interface RouteCooldowns {
  /** Record that `route` is exhausted until `untilMs`; a later expiry never shortens it. */
  hold(route: ProviderRoute, width: CooldownWidth, untilMs: number): void
  /** Epoch ms `route` is held until, or null when it is admitted at `nowMs`. */
  until(route: ProviderRoute, nowMs: number): number | null
}

const routeKey = (route: ProviderRoute) =>
  `route:${route.providerConnectionId ?? ''}:${route.modelId}`
const connectionKey = (connectionId: string) => `connection:${connectionId}`

export function createRouteCooldowns(): RouteCooldowns {
  const held = new Map<string, number>()

  const live = (key: string, nowMs: number): number | null => {
    const until = held.get(key)
    if (until === undefined) return null
    // Expired entries are dropped on read, so the map stays bounded by the routes in use.
    if (until <= nowMs) {
      held.delete(key)
      return null
    }
    return until
  }

  return {
    hold(route, width, untilMs) {
      const key =
        width === 'connection' && route.providerConnectionId
          ? connectionKey(route.providerConnectionId)
          : routeKey(route)
      held.set(key, Math.max(untilMs, held.get(key) ?? 0))
    },

    until(route, nowMs) {
      const own = live(routeKey(route), nowMs)
      const account = route.providerConnectionId
        ? live(connectionKey(route.providerConnectionId), nowMs)
        : null
      if (own === null) return account
      return account === null ? own : Math.max(own, account)
    },
  }
}
