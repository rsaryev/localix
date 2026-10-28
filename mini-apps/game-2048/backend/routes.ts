import { Hono } from 'hono'
import { z } from 'zod'
import { jsonBody, chatAnswer, type MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import { directions, modes, MoveRefused, OPPONENTS, type Game } from '../shared/game'
import type { GameService } from './game-service'

const moveBody = z.object({ direction: z.enum(directions) })
const modeBody = z.object({ mode: z.enum(modes) })
const opponentBody = z.object({ opponent: z.enum(OPPONENTS) })
const emptyBody = z.object({})

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
    .post('/game/move', jsonBody(moveBody), (c) =>
      answer(c, (chat) => games.personMove(chat, c.req.valid('json').direction)),
    )
    .post('/game/new', jsonBody(modeBody), (c) =>
      answer(c, (chat) => games.newGame(chat, c.req.valid('json').mode)),
    )
    .post('/game/mode', jsonBody(modeBody), (c) =>
      answer(c, (chat) => games.mode(chat, c.req.valid('json').mode)),
    )
    .post('/game/remind', jsonBody(emptyBody), (c) => answer(c, (chat) => games.remind(chat)))
    .post('/game/stop', jsonBody(emptyBody), (c) => answer(c, (chat) => games.stop(chat)))
    .post('/game/opponent', jsonBody(opponentBody), (c) =>
      answer(c, (chat) => games.setOpponent(chat, c.req.valid('json').opponent)),
    )
}
