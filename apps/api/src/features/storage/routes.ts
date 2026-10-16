import { Hono } from 'hono'
import { z } from 'zod'

import type { AppContext } from '../../app'
import { zValidator } from '../../lib/validator'
import { MIN_PRUNE_DAYS, type StorageService } from './service'

const pruneBody = z.object({
  olderThanDays: z.number().int().min(MIN_PRUNE_DAYS).max(3650),
  /** Count only. A caller must send `false` to delete. */
  dryRun: z.boolean(),
})

/** How much disk the app's data takes, and removing old conversations (`features/storage`). */
export function createStorageRoutes(service: StorageService) {
  return new Hono<AppContext>()
    .get('/usage', async (c) => c.json(await service.usage()))
    .post('/prune', zValidator('json', pruneBody), async (c) =>
      c.json(await service.pruneOlderThan(c.get('userId'), c.req.valid('json'))),
    )
}
