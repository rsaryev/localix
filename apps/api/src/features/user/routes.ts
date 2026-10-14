import { viewStateAddressSchema, viewStateWriteSchema } from './view-state-contracts'
import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import type { AppContext } from '../../app'
import { updateUserProfileRequestSchema } from './contracts'
import type { UserService } from './service'

export type UserRoutesService = UserService

export function createUserRoutes(service: UserRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/state/:kind/:key', zValidator('param', viewStateAddressSchema), async (c) =>
      c.json(await service.getViewState(c.get('userId'), c.req.valid('param'))),
    )
    .put('/state', zValidator('json', viewStateWriteSchema), async (c) =>
      c.json(await service.writeViewState(c.get('userId'), c.req.valid('json'))),
    )
    .get('/profile', async (c) => {
      const userId = c.get('userId')
      const profile = await service.getProfile(userId)
      return c.json(profile)
    })
    .patch('/profile', zValidator('json', updateUserProfileRequestSchema), async (c) => {
      const userId = c.get('userId')
      const body = c.req.valid('json')
      const profile = await service.updateProfile(userId, body)
      return c.json(profile)
    })

  return routes
}
