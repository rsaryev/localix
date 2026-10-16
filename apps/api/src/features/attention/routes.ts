/**
 * `GET /rpc/attention` → `{ items }`: everything waiting on the caller, oldest first.
 *
 * The `attention.updated` frame is last-wins and replayable, but a reload starts with no frame at
 * all — without this read the sidebar and the cross-session dialog came back empty until the next
 * question happened to be asked. Keyed by the caller's user id; another user's items are never in
 * the set it reads.
 */
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import type { AttentionRegistry } from './registry'

export function createAttentionRoutes(attention: Pick<AttentionRegistry, 'list'>) {
  const app = new Hono<AppContext>()
  const routes = app.get('/', (c) => c.json({ items: attention.list(c.get('userId')) }, 200))
  routes.onError(defaultErrorHandler)
  return routes
}
