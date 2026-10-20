import { Hono, type Context } from 'hono'
import { z } from 'zod'
import {
  jsonBody,
  jsonError,
  type PluginRouteContext,
  type Seat,
} from '@localixai/plugin-sdk/backend'

import { directions, modes, MoveRefused, type Game } from '../shared/game'
import { MAX_HEADINGS, type GameService } from './game-service'

const turnsBody = z.object({
  fromTick: z.number().int().min(0),
  headings: z.array(z.enum(directions)).min(1).max(MAX_HEADINGS),
})
const modeBody = z.object({ mode: z.enum(modes) })
const emptyBody = z.object({})

/**
 * The view's routes. Every action answers with the NEW game. The table is the chat the board
 * belongs to: the host puts it in `c.env.sessionId` only after checking the user owns it.
 */
export function createGameRoutes(games: GameService) {
  const answer = async (c: Context<PluginRouteContext>, action: (seat: Seat) => Promise<Game>) => {
    if (!c.env.sessionId)
      return jsonError(c, 404, 'no_game', 'This game belongs to a chat that is not available.')
    try {
      return c.json(await action({ userId: c.env.userId, sessionId: c.env.sessionId }))
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
    .post('/game/turns', jsonBody(turnsBody), (c) => {
      const { fromTick, headings } = c.req.valid('json')
      return answer(c, (seat) => games.personTurns(seat, fromTick, headings))
    })
    .post('/game/new', jsonBody(modeBody), (c) =>
      answer(c, (seat) => games.newGame(seat, c.req.valid('json').mode)),
    )
    .post('/game/mode', jsonBody(modeBody), (c) =>
      answer(c, (seat) => games.mode(seat, c.req.valid('json').mode)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (seat) => games.remind(seat)))
    .post('/game/stop', jsonBody(emptyBody), (c) => answer(c, (seat) => games.stop(seat)))
}
