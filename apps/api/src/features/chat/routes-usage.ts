import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import type { AppContext } from '../../app'
import {
  loopIdRequestSchema,
  usageLogsQuerySchema,
  usageOverviewQuerySchema,
} from './routes-schemas'
import type { ChatRoutesService } from './routes-types'

/** Usage / spend analytics (powers the stats dashboard) and session loops. */
export function createChatUsageRoutes(service: ChatRoutesService) {
  return new Hono<AppContext>()
    .get('/usage/overview', zValidator('query', usageOverviewQuerySchema), async (c) => {
      const { from, to, groupBy, bucket, model, provider, session, agent } = c.req.valid('query')
      return c.json(
        await service.usageOverview(c.get('userId'), {
          from,
          to,
          groupBy: groupBy ?? 'model',
          bucket: bucket ?? 'day',
          model,
          provider,
          session,
          agent,
        }),
        200,
      )
    })
    .get('/usage/logs', zValidator('query', usageLogsQuerySchema), async (c) => {
      const { from, to, model, provider, session, agent, cursor, limit } = c.req.valid('query')
      return c.json(
        await service.usageLogs(c.get('userId'), {
          from,
          to,
          model,
          provider,
          session,
          agent,
          cursor,
          limit,
        }),
        200,
      )
    })
    .get('/usage/keys', async (c) => {
      return c.json(await service.usageKeys(c.get('userId')), 200)
    })
    .post('/loops/cancel', zValidator('json', loopIdRequestSchema), async (c) => {
      const { id } = c.req.valid('json')
      const removed = await service.cancelSessionLoop(c.get('userId'), id)
      return c.json({ removed }, 200)
    })
    .post('/loops/run', zValidator('json', loopIdRequestSchema), async (c) => {
      const { id } = c.req.valid('json')
      const fired = await service.runSessionLoop(c.get('userId'), id)
      return c.json({ fired }, 200)
    })
}
