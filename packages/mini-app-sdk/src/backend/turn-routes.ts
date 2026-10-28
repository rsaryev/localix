import type { Context } from 'hono'

import type { ChatRef } from './agent-turn'
import { jsonError, type MiniAppRouteContext } from './http'

/**
 * A game view's route answer. The table is the chat the board belongs to: the view names it as
 * `?sessionId=`, and the host puts it in `c.env.sessionId` ONLY after checking the user owns it —
 * so a request for a foreign or deleted chat arrives without one, and is refused (404 `missing`)
 * before any game is touched. Every action answers with the NEW game (through `view`, when the
 * stored game holds what the person may not see), so the board shows its result at once. A move
 * the rules refuse answers 409 with the rules' own sentence; anything else is a game that could
 * not be saved.
 */
export function chatAnswer<G, V = G>(options: {
  missing: { code: string; message: string }
  refused: { error: abstract new (...args: never[]) => Error; code: string }
  view?: (game: G) => V
}) {
  const view = options.view ?? ((game: G) => game as unknown as V)
  return async (c: Context<MiniAppRouteContext>, action: (chat: ChatRef) => Promise<G>) => {
    const sessionId = c.env.sessionId
    if (!sessionId) return jsonError(c, 404, options.missing.code, options.missing.message)
    try {
      return c.json(view(await action({ userId: c.env.userId, sessionId })) as object)
    } catch (error) {
      if (error instanceof options.refused.error)
        return jsonError(c, 409, options.refused.code, error.message)
      return jsonError(c, 503, 'game_unavailable', 'The game could not be saved. Try again.')
    }
  }
}
