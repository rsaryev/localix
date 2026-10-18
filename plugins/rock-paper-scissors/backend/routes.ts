import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { jsonBody, jsonError, type PluginRouteContext } from '@localixai/plugin-sdk/backend'

import { MoveRefused, moveSchema, PLAYERS, viewFor, type Game } from '../shared/game'
import type { Seat } from './ask-agent'
import type { GameService } from './game-service'

const playBody = z.object({ move: moveSchema })
const nextBody = z.object({ first: z.enum(PLAYERS).optional() })
const emptyBody = z.object({})

/**
 * The view's routes. Every action answers with the table AS THE PERSON MAY SEE IT
 * (`viewFor(game, 'you')`): the agent's sealed move travels as its digest alone, so it cannot be
 * read from the network panel before the round reveals it. The host fills `c.env.sessionId` only
 * after checking the user owns that chat; without one the request is refused before any game is
 * touched. A move the rules refuse answers 409 with the rules' own sentence.
 */
export function createGameRoutes(games: GameService) {
  const answer = async (c: Context<PluginRouteContext>, action: (seat: Seat) => Promise<Game>) => {
    const sessionId = c.env.sessionId
    if (!sessionId)
      return jsonError(c, 404, 'no_table', 'This table belongs to a chat that is not available.')
    try {
      return c.json(viewFor(await action({ userId: c.env.userId, sessionId }), 'you'))
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
    .post('/game/play', jsonBody(playBody), (c) =>
      answer(c, (seat) => games.personMove(seat, c.req.valid('json').move)),
    )
    .post('/game/next', jsonBody(nextBody), (c) =>
      answer(c, (seat) => games.nextRound(seat, c.req.valid('json').first)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (seat) => games.remind(seat)))
}
