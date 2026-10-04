import { Hono } from 'hono'
import { z } from 'zod'

import type { AppContext } from '../../app'
import { zValidator } from '../../lib/validator'
import { clientJournalOpsSchema, type ClientJournalOp } from './contracts'
import type { NotificationJournal } from './journal'

/**
 * The Event Center's HTTP surface: read the caller's inbox (whole, or since a cursor) and apply the
 * client's own ops — facts only it knows, and the person's read / remove / clear. Live changes ride
 * the realtime socket (`n` frames, `features/realtime/ws.ts`); a client resyncs here on connect.
 */
export function createNotificationRoutes(journal: Pick<NotificationJournal, 'sync' | 'apply'>) {
  const app = new Hono<AppContext>()
  return app
    .get(
      '/',
      zValidator('query', z.object({ since: z.coerce.number().int().min(0).optional() })),
      async (c) => c.json(await journal.sync(c.get('userId'), c.req.valid('query').since ?? 0)),
    )
    .post('/ops', zValidator('json', clientJournalOpsSchema), async (c) => {
      const { ops } = c.req.valid('json')
      return c.json({ changes: await journal.apply(c.get('userId'), ops as ClientJournalOp[]) })
    })
}
