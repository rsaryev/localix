import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import type { AppContext } from '../../app'
import {
  createSessionRequestSchema,
  importSessionRequestSchema,
  messageParamsSchema,
  sessionParamsSchema,
  updateSessionRequestSchema,
} from './contracts'
import { historySearchQuerySchema, sessionQuerySchema } from './routes-schemas'
import type { ChatRoutesService } from './routes-types'

/** Session lifecycle: list, search, create/import, read, update, delete. */
export function createChatSessionsRoutes(service: ChatRoutesService) {
  return (
    new Hono<AppContext>()
      .get('/sessions', async (c) => {
        return c.json(await service.listSessions(c.get('userId')), 200)
      })
      .get('/history-search', zValidator('query', historySearchQuerySchema), async (c) => {
        const { q, limit } = c.req.valid('query')
        return c.json({ hits: await service.searchHistory(c.get('userId'), q, limit ?? 30) }, 200)
      })
      .post('/sessions', zValidator('json', createSessionRequestSchema), async (c) => {
        // Handles on the wire become the service's party. The mapping lives here because it is
        // transport shape meeting domain shape: the wire says WHO is in the conversation, the
        // service's richer form also says what each of them runs on, which a client never states
        // at creation — an unrouted member inherits the session's model like any other.
        const { agentIds, ...input } = c.req.valid('json')
        return c.json(
          await service.createSession(c.get('userId'), {
            ...input,
            ...(agentIds?.length ? { agents: agentIds.map((agentId) => ({ agentId })) } : {}),
          }),
          201,
        )
      })
      // Import a conversation from outside Localix. The body is our OWN message model — nothing here
      // knows what produced it, which is what lets the next importer reuse the route unchanged.
      .post('/sessions/import', zValidator('json', importSessionRequestSchema), async (c) => {
        try {
          const session = await service.importSession(c.get('userId'), c.req.valid('json'))
          return c.json(session, 201)
        } catch (error) {
          // A refused import is a caller problem (empty, too large) and its message names the limit.
          return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
        }
      })
      .get(
        '/sessions/:id',
        zValidator('param', sessionParamsSchema),
        zValidator('query', sessionQuerySchema),
        async (c) => {
          return c.json(
            await service.getSession(c.get('userId'), c.req.valid('param').id, {
              messageLimit: c.req.valid('query').messageLimit,
              deferToolDetails: c.req.valid('query').toolDetails === 'deferred',
            }),
            200,
          )
        },
      )
      .get('/sessions/:id/join-routes', zValidator('param', sessionParamsSchema), async (c) => {
        return c.json(await service.getJoinRoutes(c.get('userId'), c.req.valid('param').id), 200)
      })
      // What a plugin's `subagentStatusLine` last drew in this conversation's subagent rows; the
      // server redraws them and pokes `subagent-rows` when they change.
      .get('/sessions/:id/subagent-rows', zValidator('param', sessionParamsSchema), async (c) => {
        const { id } = c.req.valid('param')
        return c.json(await service.getSubagentRows(c.get('userId'), id), 200)
      })
      .get(
        '/sessions/:id/messages/:messageId/tool-details',
        zValidator('param', messageParamsSchema),
        async (c) => {
          const { id, messageId } = c.req.valid('param')
          return c.json(await service.getMessageToolDetails(c.get('userId'), id, messageId), 200)
        },
      )
      .patch(
        '/sessions/:id',
        zValidator('param', sessionParamsSchema),
        zValidator('json', updateSessionRequestSchema),
        async (c) => {
          // Same wire-to-domain mapping as creation: the client states membership, the service
          // owns what each participant runs on (`reseatParticipants` keeps a survivor's own route).
          const { agentIds, ...patch } = c.req.valid('json')
          return c.json(
            await service.updateSession(c.get('userId'), c.req.valid('param').id, {
              ...patch,
              ...(agentIds?.length ? { agents: agentIds.map((agentId) => ({ agentId })) } : {}),
            }),
            200,
          )
        },
      )
      .delete('/sessions/:id', zValidator('param', sessionParamsSchema), async (c) => {
        await service.deleteSession(c.get('userId'), c.req.valid('param').id)
        return c.body(null, 204)
      })
  )
}
