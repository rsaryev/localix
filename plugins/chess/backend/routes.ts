import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { jsonBody, jsonError, type PluginRouteContext } from '@localixai/plugin-sdk/backend'

import { MoveRefused, SIDES, type Game } from '../shared/game'
import type { Seat } from './ask-agent'
import type { GameService } from './game-service'

/** A move in coordinates, as the board sends it ("e2e4", "e7e8n"), or in SAN. */
const moveBody = z.object({ move: z.string().min(2).max(12) })
const newGameBody = z.object({ you: z.enum(SIDES).optional() })
const emptyBody = z.object({})

/**
 * The view's routes. Every action answers with the NEW game, so the board shows its result at
 * once. The table is the chat the board belongs to: the view names it as `?sessionId=`, and the
 * host puts it in `c.env.sessionId` ONLY after checking the user owns it — so a request for a
 * foreign or deleted chat arrives without one, and is refused here before any game is touched. A
 * move the rules refuse answers 409 with the rules' own sentence ("Ke2 is not a legal move here.").
 */
export function createGameRoutes(games: GameService) {
  const answer = async (c: Context<PluginRouteContext>, action: (seat: Seat) => Promise<Game>) => {
    const sessionId = c.env.sessionId
    if (!sessionId)
      return jsonError(c, 404, 'no_table', 'This board belongs to a chat that is not available.')
    try {
      return c.json(await action({ userId: c.env.userId, sessionId }))
    } catch (error) {
      if (error instanceof MoveRefused) return jsonError(c, 409, 'move_refused', error.message)
      return jsonError(c, 503, 'game_unavailable', 'The game could not be saved. Try again.')
    }
  }

  return new Hono<PluginRouteContext>()
    .get('/game', (c) => {
      c.header('Cache-Control', 'no-store')
      return answer(c, (seat) => games.read(seat))
    })
    .post('/game/move', jsonBody(moveBody), (c) =>
      answer(c, (seat) => games.personMove(seat, c.req.valid('json').move)),
    )
    .post('/game/new', jsonBody(newGameBody), (c) =>
      answer(c, (seat) => games.newGame(seat, c.req.valid('json').you)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (seat) => games.remind(seat)))
}
