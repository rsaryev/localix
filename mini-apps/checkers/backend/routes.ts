import { Hono } from 'hono'
import { z } from 'zod'
import { jsonBody, chatAnswer, type MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'

import { MoveRefused, OPPONENTS, SIDES, type Game } from '../shared/game'
import type { GameService } from './game-service'

/** A move as the squares it visits, start first; a capture of all twelve visits thirteen. */
const moveBody = z.object({ squares: z.array(z.number().int().min(0).max(63)).min(2).max(13) })
const newGameBody = z.object({ you: z.enum(SIDES).optional() })
const opponentBody = z.object({ opponent: z.enum(OPPONENTS) })
const emptyBody = z.object({})

/**
 * The view's routes. Every action answers with the NEW game, so the board shows its result at
 * once. The table is the chat the board belongs to: the view names it as `?sessionId=`, and the
 * host puts it in `c.env.sessionId` ONLY after checking the user owns it — so a request for a
 * foreign or deleted chat arrives without one, and is refused here before any game is touched. A
 * move the rules refuse answers 409 with the rules' own sentence ("A capture is compulsory. Legal
 * moves: d4:f6.").
 */
export function createGameRoutes(games: GameService) {
  const answer = chatAnswer<Game>({
    missing: { code: 'no_table', message: 'This board belongs to a chat that is not available.' },
    refused: { error: MoveRefused, code: 'move_refused' },
  })

  return new Hono<MiniAppRouteContext>()
    .get('/game', (c) => {
      c.header('Cache-Control', 'no-store')
      return answer(c, (chat) => games.read(chat))
    })
    .post('/game/move', jsonBody(moveBody), (c) =>
      answer(c, (chat) => games.personMove(chat, c.req.valid('json').squares)),
    )
    .post('/game/new', jsonBody(newGameBody), (c) =>
      answer(c, (chat) => games.newGame(chat, c.req.valid('json').you)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (chat) => games.remind(chat)))
    .post('/game/opponent', jsonBody(opponentBody), (c) =>
      answer(c, (chat) => games.setOpponent(chat, c.req.valid('json').opponent)),
    )
}
