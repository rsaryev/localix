import { Hono, type Context } from 'hono'
import {
  jsonBody,
  jsonError,
  type MiniAppAgentDirectory,
  type MiniAppRouteContext,
} from '@localixai/mini-app-sdk/backend'

import {
  createKanbanTaskSchema,
  kanbanMovesSchema,
  updateKanbanTaskSchema,
} from '../shared/contracts'
import { BoardRefusal } from '../shared/errors'
import type { BoardChat, BoardService } from './service'

/**
 * The view's routes: a person's hand on the board. The board is the chat it belongs to — the view
 * names it as `?sessionId=`, and the host sets `c.env.sessionId` ONLY after checking the user
 * owns that chat — so a request for a foreign or deleted chat arrives without one and is refused
 * before any card is read. Every write here is the `user` actor's, which is what makes the
 * board's transition table and the `user` origin mean anything.
 */
export function createBoardRoutes(boards: BoardService, agents?: MiniAppAgentDirectory) {
  const answer = async <T>(
    c: Context<MiniAppRouteContext>,
    action: (chat: BoardChat) => Promise<T>,
    status: 200 | 201 = 200,
  ) => {
    const sessionId = c.env.sessionId
    if (!sessionId)
      return jsonError(c, 404, 'no_board', 'This board belongs to a chat that is not available.')
    try {
      const result = await action({ userId: c.env.userId, sessionId })
      return result === undefined ? c.body(null, 204) : c.json(result, status)
    } catch (error) {
      if (error instanceof BoardRefusal)
        return jsonError(c, error.status, error.code, error.message)
      return jsonError(c, 503, 'board_unavailable', 'The board could not be saved. Try again.')
    }
  }

  return (
    new Hono<MiniAppRouteContext>()
      .get('/board', (c) => {
        c.header('Cache-Control', 'no-store')
        return answer(c, (chat) => boards.read(chat))
      })
      .get('/agents', (c) =>
        answer(c, async (chat) => ({
          agents: agents ? await agents.list(chat.userId, chat.sessionId) : [],
        })),
      )
      .post('/tasks', jsonBody(createKanbanTaskSchema), (c) =>
        answer(c, (chat) => boards.create(chat, c.req.valid('json'), 'user'), 201),
      )
      // One drag, one request: the batch lands together or not at all.
      .post('/moves', jsonBody(kanbanMovesSchema), (c) =>
        answer(c, async (chat) => ({
          tasks: await boards.move(chat, c.req.valid('json').moves, 'user'),
        })),
      )
      .get('/tasks/:id', (c) => answer(c, (chat) => boards.get(chat, c.req.param('id'))))
      .patch('/tasks/:id', jsonBody(updateKanbanTaskSchema), (c) =>
        answer(c, (chat) => boards.update(chat, c.req.param('id'), c.req.valid('json'), 'user')),
      )
      .delete('/tasks/:id', (c) => answer(c, (chat) => boards.remove(chat, c.req.param('id'))))
  )
}
