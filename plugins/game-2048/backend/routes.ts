import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { jsonBody, jsonError, type PluginRouteContext } from '@localixai/plugin-sdk/backend'
import { directions, modes, MoveRefused, type Game } from '../shared/game'
import type { Seat } from './ask-agent'
import type { GameService } from './game-service'

const moveBody = z.object({ direction: z.enum(directions) })
const modeBody = z.object({ mode: z.enum(modes) })
const emptyBody = z.object({})

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
    .post('/game/move', jsonBody(moveBody), (c) =>
      answer(c, (seat) => games.personMove(seat, c.req.valid('json').direction)),
    )
    .post('/game/new', jsonBody(modeBody), (c) =>
      answer(c, (seat) => games.newGame(seat, c.req.valid('json').mode)),
    )
    .post('/game/mode', jsonBody(modeBody), (c) =>
      answer(c, (seat) => games.mode(seat, c.req.valid('json').mode)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (seat) => games.remind(seat)))
}
