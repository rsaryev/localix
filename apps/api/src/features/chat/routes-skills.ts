import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import type { AppContext } from '../../app'
import { sessionParamsSchema } from './contracts'
import { sessionSkillsRequestSchema } from './routes-schemas'
import type { ChatRoutesService } from './routes-types'

/** Per-session skill selection. Skills are written through the Store (`skills-curator`). */
export function createChatSkillsRoutes(service: ChatRoutesService) {
  return new Hono<AppContext>().post(
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
}
