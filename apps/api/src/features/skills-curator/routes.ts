import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'

import type { AppContext } from '../../app'
import {
  archiveSkillRequestSchema,
  curatorReportSchema,
  curatorSkillRecordSchema,
  listCuratorSkillsResponseSchema,
  restoreSkillRequestSchema,
  runCuratorRequestSchema,
  setSkillPinnedRequestSchema,
} from './contracts'
import type { SkillsCuratorService } from './service'

/** Mounted at `/rpc/skills/curator`. */
export function createSkillsCuratorRoutes(service: SkillsCuratorService) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/', zValidator('query', z.object({ projectId: z.string().optional() })), async (c) => {
      const { projectId } = c.req.valid('query')
      const skills = await service.listSkills(c.get('userId'), { projectId: projectId ?? null })
      return c.json(listCuratorSkillsResponseSchema.parse({ skills }), 200)
    })
    .post('/pin', zValidator('json', setSkillPinnedRequestSchema), async (c) => {
      const input = c.req.valid('json')
      const record = await service.setPinned(c.get('userId'), input)
      return c.json(curatorSkillRecordSchema.parse(record), 200)
    })
    .post('/archive', zValidator('json', archiveSkillRequestSchema), async (c) => {
      const record = await service.archive(c.get('userId'), c.req.valid('json'))
      return c.json(curatorSkillRecordSchema.parse(record), 200)
    })
    .post('/restore', zValidator('json', restoreSkillRequestSchema), async (c) => {
      const record = await service.restore(c.get('userId'), c.req.valid('json'))
      return c.json(curatorSkillRecordSchema.parse(record), 200)
    })
    .post('/run', zValidator('json', runCuratorRequestSchema), async (c) => {
      const report = await service.runCurator(c.get('userId'), c.req.valid('json'))
      return c.json(curatorReportSchema.parse(report), 200)
    })

  return routes
}
