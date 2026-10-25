import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'

import type { AppContext } from '../../app'
import { curatorReportSchema, runCuratorRequestSchema } from './contracts'
import type { SkillsCuratorService } from './service'

/** Mounted at `/rpc/skills/curator`. */
export function createSkillsCuratorRoutes(service: SkillsCuratorService) {
  const app = new Hono<AppContext>()

  const routes = app.post('/run', zValidator('json', runCuratorRequestSchema), async (c) => {
    const report = await service.runCurator(c.get('userId'), c.req.valid('json'))
    return c.json(curatorReportSchema.parse(report), 200)
  })

  return routes
}
