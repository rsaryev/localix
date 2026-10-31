/**
 * `host.decisions` for one mini app: the decision service, attributed to the mini app.
 *
 * A mini app's purpose is rewritten to `mini-app:<app>:<purpose>`, so the log says whose decision
 * it was, and its spend lands in the ledger's `decision` row against the session it named — a
 * session the user must own: the host checks it first, so a mini app cannot bill a chat it was not
 * given.
 */
import type { DecisionHost } from '@localixai/mini-app-sdk/backend'
import type { DecisionService } from './service'

const PURPOSE = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function miniAppPurpose(miniAppName: string, purpose: string): string {
  if (!PURPOSE.test(purpose)) {
    throw new Error(`invalid decision purpose "${purpose}" (lowercase letters, digits, . _ -)`)
  }
  return `mini-app:${miniAppName}:${purpose}`
}

export function createMiniAppDecisionHost(
  service: DecisionService,
  miniAppName: string,
  /** Rejects a session the user does not own or that no longer exists. */
  authorize: (userId: string, sessionId: string) => Promise<unknown>,
): DecisionHost {
  return {
    available: (userId) => service.available(userId),
    async decide(userId, ask, options) {
      const purpose = miniAppPurpose(miniAppName, options.purpose)
      await authorize(userId, options.sessionId)
      return service.decide(userId, ask, { ...options, purpose })
    },
  }
}
