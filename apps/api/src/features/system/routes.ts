import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'
import type { AppContext } from '../../app'
import type { SystemService } from './service'

const setBody = z.object({ enabled: z.boolean() })

/** Generic host-level system controls (keep-awake, …) — see features/system. */
export function createSystemRoutes(service: SystemService) {
  const app = new Hono<AppContext>()

  return app
    .get('/toggles', (c) => c.json({ toggles: service.listToggles() }))
    .post('/toggles/:id', zValidator('json', setBody), async (c) => {
      const id = c.req.param('id')
      const { enabled } = c.req.valid('json')
      return c.json(await service.setToggle(id, enabled))
    })
}
