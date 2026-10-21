import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import type { AppContext } from '../../app'
import { jsonError } from '../../lib/http'
import {
  branchParamsSchema,
  checkoutBranchRequestSchema,
  forkSessionRequestSchema,
  toolInteractSchema,
  messageParamsSchema,
  sendMessageRequestSchema,
  sessionParamsSchema,
  switchBranchRequestSchema,
  editMessageRequestSchema,
  regenerateRequestSchema,
} from './contracts'
import {
  messageTaskRequestSchema,
  pinRequestSchema,
  queueItemRequestSchema,
  queueRemoveRequestSchema,
  reactionRequestSchema,
  stopMonitorRequestSchema,
} from './routes-schemas'
import type { ChatRoutesService } from './routes-types'

/** Turns and messages: send, regenerate, edit, branches, forks, queue. */
export function createChatMessagesRoutes(service: ChatRoutesService) {
  return new Hono<AppContext>()
    .post(
      '/sessions/:id/messages',
      zValidator('param', sessionParamsSchema),
      zValidator('json', sendMessageRequestSchema),
      async (c) => {
        return c.json(
          await service.sendMessage(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('json').prompt,
            c.req.valid('json').bindings,
            undefined,
            c.req.valid('json').isInternal,
            c.req.valid('json').toolSurface,
            c.req.valid('json').clientMessageId,
          ),
          202,
        )
      },
    )
    .post(
      '/sessions/:id/regenerate',
      zValidator('param', sessionParamsSchema),
      zValidator('json', regenerateRequestSchema),
      async (c) => {
        return c.json(
          await service.regenerate(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('json').toolSurface,
            c.req.valid('json').expectedMessageId,
          ),
          202,
        )
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/rollback',
      zValidator('param', messageParamsSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(await service.rollback(c.get('userId'), id, messageId), 200)
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/reactions',
      zValidator('param', messageParamsSchema),
      zValidator('json', reactionRequestSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(
          await service.reactToMessage(c.get('userId'), id, messageId, c.req.valid('json').emoji),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/pin',
      zValidator('param', messageParamsSchema),
      zValidator('json', pinRequestSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(
          await service.pinMessage(c.get('userId'), id, messageId, c.req.valid('json').pinned),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/tasks',
      zValidator('param', messageParamsSchema),
      zValidator('json', messageTaskRequestSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        const { key, checked } = c.req.valid('json')
        return c.json(
          await service.checkMessageTask(c.get('userId'), id, messageId, key, checked),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/edit',
      zValidator('param', messageParamsSchema),
      zValidator('json', editMessageRequestSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        const { content, toolSurface } = c.req.valid('json')
        return c.json(
          await service.editMessage(c.get('userId'), id, messageId, content, toolSurface),
          202,
        )
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/thread',
      zValidator('param', messageParamsSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(await service.openMessageThread(c.get('userId'), id, messageId), 200)
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/switch-branch',
      zValidator('param', branchParamsSchema),
      zValidator('json', switchBranchRequestSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(
          await service.switchBranch(
            c.get('userId'),
            id,
            messageId,
            c.req.valid('json').branchIndex,
          ),
          200,
        )
      },
    )
    .get('/sessions/:id/branches', zValidator('param', sessionParamsSchema), async (c) => {
      return c.json(await service.getBranchTree(c.get('userId'), c.req.valid('param').id), 200)
    })
    .post(
      '/sessions/:id/branches/checkout',
      zValidator('param', sessionParamsSchema),
      zValidator('json', checkoutBranchRequestSchema),
      async (c) => {
        return c.json(
          await service.checkoutBranch(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('json').messageId,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/fork',
      zValidator('param', sessionParamsSchema),
      zValidator('json', forkSessionRequestSchema),
      async (c) => {
        return c.json(
          await service.forkSession(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('json').messageId,
          ),
          201,
        )
      },
    )
    .post('/sessions/:id/stop', zValidator('param', sessionParamsSchema), async (c) => {
      const stopped = await service.stop(c.req.valid('param').id, c.get('userId'))
      return c.json({ stopped }, 200)
    })
    .post(
      '/sessions/:id/monitors/stop',
      zValidator('param', sessionParamsSchema),
      zValidator('json', stopMonitorRequestSchema),
      async (c) => {
        // Session-scoped on purpose: a monitor id is per-session (`mon-1`), so the pair is
        // what identifies one — and the service checks the OWNER before stopping anything.
        const stopped = service.stopSessionMonitor(
          c.get('userId'),
          c.req.valid('param').id,
          c.req.valid('json').monitorId,
        )
        return c.json({ stopped }, 200)
      },
    )
    .post('/tools/interact', zValidator('json', toolInteractSchema), async (c) => {
      const { toolCallId, action, payload } = c.req.valid('json')
      const result = service.interact(toolCallId, action, payload, c.get('userId'))
      if (!result.ok)
        return jsonError(c, 404, 'interaction_failed', result.error ?? 'Interaction failed')
      return c.json({ ok: true }, 200)
    })
    .post(
      '/sessions/:id/queue/remove',
      zValidator('param', sessionParamsSchema),
      zValidator('json', queueRemoveRequestSchema),
      async (c) => {
        const { itemId, wholeBatch } = c.req.valid('json')
        const result = await service.removeQueuedMessage(
          c.get('userId'),
          c.req.valid('param').id,
          itemId,
          wholeBatch ? { wholeBatch } : undefined,
        )
        return c.json(result, 200)
      },
    )
    .post(
      '/sessions/:id/queue/send-now',
      zValidator('param', sessionParamsSchema),
      zValidator('json', queueItemRequestSchema),
      async (c) => {
        const { itemId } = c.req.valid('json')
        return c.json(
          await service.interruptAndPromoteQueuedMessage(
            c.get('userId'),
            c.req.valid('param').id,
            itemId,
          ),
          200,
        )
      },
    )
    .post('/sessions/:id/queue/clear', zValidator('param', sessionParamsSchema), async (c) => {
      return c.json(
        await service.clearQueuedMessages(c.get('userId'), c.req.valid('param').id),
        200,
      )
    })
}
