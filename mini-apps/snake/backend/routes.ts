import { Hono } from 'hono'
import { z } from 'zod'
import { jsonBody, chatAnswer, type MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'

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
  const answer = chatAnswer<Game>({
    missing: { code: 'no_game', message: 'This game belongs to a chat that is not available.' },
    refused: { error: MoveRefused, code: 'move_refused' },
  })
  return new Hono<MiniAppRouteContext>()
    .get('/game', (c) => {
      c.header('Cache-Control', 'no-store')
      return answer(c, (chat) => games.read(chat))
    })
    .post('/game/turns', jsonBody(turnsBody), (c) => {
      const { fromTick, headings } = c.req.valid('json')
      return answer(c, (chat) => games.personTurns(chat, fromTick, headings))
    })
    .post('/game/new', jsonBody(modeBody), (c) =>
      answer(c, (chat) => games.newGame(chat, c.req.valid('json').mode)),
    )
    .post('/game/mode', jsonBody(modeBody), (c) =>
      answer(c, (chat) => games.mode(chat, c.req.valid('json').mode)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (chat) => games.remind(chat)))
    .post('/game/stop', jsonBody(emptyBody), (c) => answer(c, (chat) => games.stop(chat)))
}
