/**
 * The comments surface — `GET /`, `POST /`, `PATCH /:id`, `DELETE /:id` under `/rpc/comments`.
 *
 * Owner-scoped through the repository: the caller's user id is part of every statement, so a
 * comment id from another user's scope is a 404 like an id that never existed.
 */
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { defaultErrorHandler, jsonError } from '../../lib/http'
import { zValidator } from '../../lib/validator'
import {
  commentParamsSchema,
  createCommentSchema,
  listCommentsQuerySchema,
  updateCommentSchema,
  type CommentRecord,
  type CommentView,
} from './contracts'
import type { CommentRepository } from './repository'

const view = ({ userId: _owner, ...comment }: CommentRecord): CommentView => comment

export function createCommentRoutes(comments: CommentRepository) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/', zValidator('query', listCommentsQuerySchema), async (c) => {
      const list = await comments.list(c.get('userId'), c.req.valid('query').scope)
      return c.json({ comments: list.map(view) }, 200)
    })
    .post('/', zValidator('json', createCommentSchema), async (c) => {
      const created = await comments.create({ userId: c.get('userId'), ...c.req.valid('json') })
      return c.json({ comment: view(created) }, 201)
    })
    .patch(
      '/:id',
      zValidator('param', commentParamsSchema),
      zValidator('json', updateCommentSchema),
      async (c) => {
        const updated = await comments.update(
          c.get('userId'),
          c.req.valid('param').id,
          c.req.valid('json'),
        )
        if (!updated) return jsonError(c, 404, 'comment_not_found', 'No such comment')
        return c.json({ comment: view(updated) }, 200)
      },
    )
    .delete('/:id', zValidator('param', commentParamsSchema), async (c) => {
      const removed = await comments.remove(c.get('userId'), c.req.valid('param').id)
      if (!removed) return jsonError(c, 404, 'comment_not_found', 'No such comment')
      return c.json({ ok: true }, 200)
    })

  routes.onError(defaultErrorHandler)
  return routes
}
