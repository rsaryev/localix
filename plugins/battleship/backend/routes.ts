import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { jsonBody, jsonError, type PluginRouteContext } from '@localixai/plugin-sdk/backend'

import { PLAYERS, ShotRefused, viewFor, type Game } from '../shared/game'
import { SIZE } from '../shared/rules'
import type { Seat } from './ask-agent'
import type { GameService } from './game-service'

const shotBody = z.object({
  cell: z
    .number()
    .int()
    .min(0)
    .max(SIZE * SIZE - 1),
})
const newGameBody = z.object({ first: z.enum(PLAYERS).optional() })
const emptyBody = z.object({})

/**
 * The view's routes. Every action answers with the NEW game AS THE PERSON MAY SEE IT
 * (`viewFor(game, 'you')`): their own fleet, and of the agent's only what their shots revealed.
 * The agent's fleet is never in a response, so it cannot be read from the network panel.
 *
 * The table is the chat the board belongs to: the view names it as `?sessionId=`, and the host
 * puts it in `c.env.sessionId` ONLY after checking the user owns it — so a request for a foreign
 * or deleted chat arrives without one, and is refused here before any game is touched. A shot the
 * rules refuse answers 409 with the rules' own sentence ("E5 is already known").
 */
export function createGameRoutes(games: GameService) {
  const answer = async (c: Context<PluginRouteContext>, action: (seat: Seat) => Promise<Game>) => {
    const sessionId = c.env.sessionId
    if (!sessionId)
      return jsonError(c, 404, 'no_table', 'This board belongs to a chat that is not available.')
    try {
      return c.json(viewFor(await action({ userId: c.env.userId, sessionId }), 'you'))
    } catch (error) {
      if (error instanceof ShotRefused) return jsonError(c, 409, 'shot_refused', error.message)
      return jsonError(c, 503, 'game_unavailable', 'The game could not be saved. Try again.')
    }
  }

  return new Hono<PluginRouteContext>()
    .get('/game', (c) => {
      c.header('Cache-Control', 'no-store')
      return answer(c, (seat) => games.read(seat))
    })
    .post('/game/fire', jsonBody(shotBody), (c) =>
      answer(c, (seat) => games.personShot(seat, c.req.valid('json').cell)),
    )
    .post('/game/reshuffle', jsonBody(emptyBody), (c) => answer(c, (seat) => games.reshuffle(seat)))
    .post('/game/new', jsonBody(newGameBody), (c) =>
      answer(c, (seat) => games.newGame(seat, c.req.valid('json').first)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (seat) => games.remind(seat)))
}
