import { Hono } from 'hono'
import { z } from 'zod'
import { jsonBody, chatAnswer, type MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'

import { OPPONENTS, PLAYERS, ShotRefused, viewFor, type Game } from '../shared/game'
import { SIZE } from '../shared/rules'
import type { GameService } from './game-service'

const shotBody = z.object({
  cell: z
    .number()
    .int()
    .min(0)
    .max(SIZE * SIZE - 1),
})
const newGameBody = z.object({ first: z.enum(PLAYERS).optional() })
const opponentBody = z.object({ opponent: z.enum(OPPONENTS) })
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
  const answer = chatAnswer({
    missing: { code: 'no_table', message: 'This board belongs to a chat that is not available.' },
    refused: { error: ShotRefused, code: 'shot_refused' },
    view: (game: Game) => viewFor(game, 'you'),
  })

  return new Hono<MiniAppRouteContext>()
    .get('/game', (c) => {
      c.header('Cache-Control', 'no-store')
      return answer(c, (chat) => games.read(chat))
    })
    .post('/game/fire', jsonBody(shotBody), (c) =>
      answer(c, (chat) => games.personShot(chat, c.req.valid('json').cell)),
    )
    .post('/game/reshuffle', jsonBody(emptyBody), (c) => answer(c, (chat) => games.reshuffle(chat)))
    .post('/game/new', jsonBody(newGameBody), (c) =>
      answer(c, (chat) => games.newGame(chat, c.req.valid('json').first)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (chat) => games.remind(chat)))
    .post('/game/opponent', jsonBody(opponentBody), (c) =>
      answer(c, (chat) => games.setOpponent(chat, c.req.valid('json').opponent)),
    )
}
