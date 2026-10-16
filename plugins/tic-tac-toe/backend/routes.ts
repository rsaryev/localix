import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { jsonBody, jsonError, type PluginRouteContext } from '@localixai/plugin-sdk/backend'

import { MoveRefused, type Game } from '../shared/game'
import type { Seat } from './ask-agent'
import type { GameService } from './game-service'

const moveBody = z.object({ cell: z.number().int().min(0).max(8) })
const newGameBody = z.object({ first: z.enum(['X', 'O']).optional() })
const emptyBody = z.object({})

/**
 * The view's routes. Every action answers with the NEW game, so the board shows its result at
 * once. The table is the chat the board belongs to: the view names it as `?sessionId=`, and the
 * host puts it in `c.env.sessionId` ONLY after checking the user owns it — so a request for a
 * foreign or deleted chat arrives without one, and is refused here before any game is touched. A
 * move the rules refuse answers 409 with the rules' own sentence ("The top left (cell 1) is
 * taken.").
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
      answer(c, (seat) => games.personMove(seat, c.req.valid('json').cell)),
    )
    .post('/game/new', jsonBody(newGameBody), (c) =>
      answer(c, (seat) => games.newGame(seat, c.req.valid('json').first)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (seat) => games.remind(seat)))
}
