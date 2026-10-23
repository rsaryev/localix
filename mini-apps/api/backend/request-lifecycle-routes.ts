import type { Hono, Schema } from 'hono'
import { z } from 'zod'
import type { MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import type { RestRouteScope } from './route-scope'
import { validated } from './route-validation'
import { REQUEST_NOT_FOUND, toInfo } from './request-route-values'
import { dropHistory, listHistory, renameHistory } from './history'

/** Register request lifecycle and response-history routes in their existing order. */
export function registerRequestLifecycleRoutes<TSchema extends Schema>(
  app: Hono<MiniAppRouteContext, TSchema>,
  { uid, sid, collection }: Pick<RestRouteScope, 'uid' | 'sid' | 'collection'>,
) {
  return (
    app
      .delete('/requests/:name', async (c) => {
        const userId = uid(c)
        const name = c.req.param('name')
        const saved = await collection(c).get(name)
        if (!saved) return c.json(REQUEST_NOT_FOUND, 404)
        await collection(c).remove(name)
        dropHistory(userId, name, sid(c))
        return c.json({ ok: true })
      })

      // Rename delegates the file move to the store and carries this session's response history.
      // The name is the identity, and an existing target is never overwritten.
      .post(
        '/requests/:name/rename',
        validated('json', z.object({ to: z.string() })),
        async (c) => {
          const userId = uid(c)
          const from = c.req.param('name')
          const to = c.req.valid('json').to.trim()
          if (to === '') {
            return c.json({ error: 'A name is required.', code: 'bad_request' as const }, 400)
          }
          const saved = await collection(c).get(from)
          if (!saved) return c.json(REQUEST_NOT_FOUND, 404)
          if (to === from) return c.json({ request: toInfo(saved) })
          if (await collection(c).get(to)) {
            return c.json(
              { error: `A request named "${to}" already exists.`, code: 'name_taken' as const },
              409,
            )
          }
          // The MOVE is the store's — a rename here is a file moving between folders, and the
          // write/delete order that keeps it safe is not something each caller should re-derive.
          const renamed = await collection(c).rename(from, to)
          if (!renamed.ok) {
            return c.json({ error: renamed.problem, code: 'invalid_request' as const }, 422)
          }
          renameHistory(userId, from, renamed.request.name, sid(c))
          return c.json({ request: toInfo(renamed.request) })
        },
      )

      // Duplicate under the first free `<name>-copy[-N]` — the whole spec, auth included: the copy
      // is made server-side from the STORED record, so the credential never rode through a browser.
      .post('/requests/:name/duplicate', async (c) => {
        const name = c.req.param('name')
        const saved = await collection(c).get(name)
        if (!saved) return c.json(REQUEST_NOT_FOUND, 404)
        const taken = new Set((await collection(c).list()).map((r) => r.name))
        // The copy lands beside its original, in the same folder — `users/list` duplicates to
        // `users/list-copy`, not to a stray `users/list-copy` at the collection root.
        let copy = `${saved.name}-copy`
        for (let n = 2; taken.has(copy); n++) copy = `${saved.name}-copy-${n}`
        const dup = await collection(c).save(copy, saved.spec)
        if (!dup.ok) return c.json({ error: dup.problem, code: 'invalid_request' as const }, 422)
        return c.json({ request: toInfo(dup.request) }, 201)
      })

      // Recent responses, newest first. In-memory and recent-only by design — see history.ts.
      .get('/requests/:name/history', (c) => {
        return c.json({ entries: listHistory(uid(c), c.req.param('name'), sid(c)) })
      })

      // Clear a request's response history. `dropHistory` empties the ring for this name; the request
      // itself stays. A missing request is a 404, like every other per-request route here.
      .delete('/requests/:name/history', async (c) => {
        const userId = uid(c)
        const name = c.req.param('name')
        if (!(await collection(c).get(name))) {
          return c.json(REQUEST_NOT_FOUND, 404)
        }
        dropHistory(userId, name, sid(c))
        return c.json({ ok: true })
      })
  )
}
