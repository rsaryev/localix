import type { RecapService } from '../recap/service'

/** What the window is told about its request; the recap itself arrives as a transcript row. */
export type RecapRequestOutcome =
  | { status: 'created' }
  | { status: 'skipped'; reason: string }
  | { status: 'unavailable' }

/** The automatic session recap, requested by the interactive window. */
export function createChatRecapFacade(deps: {
  recapService: RecapService
  requireSession: (userId: string, id: string) => Promise<unknown>
}) {
  return {
    async requestSessionRecap(userId: string, sessionId: string): Promise<RecapRequestOutcome> {
      await deps.requireSession(userId, sessionId)
      const result = await deps.recapService.recap(userId, sessionId, 'auto')
      return result.status === 'skipped'
        ? { status: 'skipped', reason: result.reason }
        : { status: result.status }
    },
  }
}

export type ChatRecapFacade = ReturnType<typeof createChatRecapFacade>
