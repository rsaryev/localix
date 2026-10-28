import { Hono } from 'hono'
import { z } from 'zod'
import { jsonBody, chatAnswer, type MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'

import { MoveRefused, moveSchema, OPPONENTS, PLAYERS, viewFor, type Game } from '../shared/game'
import type { GameService } from './game-service'

const playBody = z.object({ move: moveSchema })
const nextBody = z.object({ first: z.enum(PLAYERS).optional() })
const opponentBody = z.object({ opponent: z.enum(OPPONENTS) })
const emptyBody = z.object({})

/**
 * The view's routes. Every action answers with the table AS THE PERSON MAY SEE IT
 * (`viewFor(game, 'you')`): the agent's sealed move travels as its digest alone, so it cannot be
 * read from the network panel before the round reveals it. The host fills `c.env.sessionId` only
 * after checking the user owns that chat; without one the request is refused before any game is
 * touched. A move the rules refuse answers 409 with the rules' own sentence.
 */
export function createGameRoutes(games: GameService) {
  const answer = chatAnswer({
    missing: { code: 'no_table', message: 'This table belongs to a chat that is not available.' },
    refused: { error: MoveRefused, code: 'move_refused' },
    view: (game: Game) => viewFor(game, 'you'),
  })

  return new Hono<MiniAppRouteContext>()
    .get('/game', (c) => {
      c.header('Cache-Control', 'no-store')
      return answer(c, (chat) => games.read(chat))
    })
    .post('/game/play', jsonBody(playBody), (c) =>
      answer(c, (chat) => games.personMove(chat, c.req.valid('json').move)),
    )
    .post('/game/next', jsonBody(nextBody), (c) =>
      answer(c, (chat) => games.nextRound(chat, c.req.valid('json').first)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (chat) => games.remind(chat)))
    .post('/game/opponent', jsonBody(opponentBody), (c) =>
      answer(c, (chat) => games.setOpponent(chat, c.req.valid('json').opponent)),
    )
}
