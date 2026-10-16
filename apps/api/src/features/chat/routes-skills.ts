import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import type { AppContext } from '../../app'
import { sessionParamsSchema } from './contracts'
import {
  sessionSkillsRequestSchema,
  skillInputSchema,
  skillScopeQuerySchema,
} from './routes-schemas'
import type { ChatRoutesService } from './routes-types'

/** Skill catalog authoring and per-session skill selection. */
export function createChatSkillsRoutes(service: ChatRoutesService) {
  return (
    new Hono<AppContext>()
      .get('/skills', zValidator('query', skillScopeQuerySchema), async (c) => {
        const { projectId } = c.req.valid('query')
        return c.json(
          await service.listSkills(c.get('userId'), {
            projectId: projectId ?? null,
          }),
          200,
        )
      })
      // ONE skill, body included — what the editor opens. The LIST is a catalog and
      // rides in the capability snapshot as summaries; see `skillSummarySchema`.
      .get('/skills/:name', zValidator('query', skillScopeQuerySchema), async (c) => {
        return c.json(
          await service.getSkill(c.get('userId'), c.req.param('name'), {
            projectId: c.req.valid('query').projectId ?? null,
          }),
          200,
        )
      })
      .post('/skills', zValidator('json', skillInputSchema), async (c) => {
        return c.json(await service.createSkill(c.get('userId'), c.req.valid('json')), 201)
      })
      .delete('/skills/:name', zValidator('query', skillScopeQuerySchema), async (c) => {
        await service.deleteSkill(
          c.get('userId'),
          c.req.param('name'),
          c.req.valid('query').projectId ?? null,
        )
        return c.body(null, 204)
      })
      .post(
        '/sessions/:id/skills',
        zValidator('param', sessionParamsSchema),
        zValidator('json', sessionSkillsRequestSchema),
        async (c) => {
          return c.json(
            await service.setSessionSkills(
              c.get('userId'),
              c.req.valid('param').id,
              c.req.valid('json').skills,
            ),
            200,
          )
        },
      )
  )
}
