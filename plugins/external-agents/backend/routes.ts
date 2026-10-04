/**
 * HTTP surface for the plugin's own UI, mounted by the host at `/rpc/agent-sessions`.
 *
 * The host mounts a plugin's routes as a SEPARATE Hono app, so the application-wide user
 * middleware is not present here. Every handler that needs a Localix session takes it from the
 * validated body rather than from context.
 *
 * The surface is exactly what the plugin's own UI calls: providers, launchers, roster, items, stats. It is not
 * a public API of the service — the agent tool calls the service DIRECTLY, so anything here with no
 * UI consumer is a door with nothing behind it. `/wait` in particular used to park an HTTP request
 * for up to thirty minutes on behalf of nobody.
 *
 * EVERY body is read through the validator, never through `c.req.json()`. That is the repo's
 * security seam, enforced by `apps/api/src/lib/route-body-contract.test.ts`: `validated('json')`
 * requires a JSON content-type, which makes the request non-simple and forces a CORS preflight
 * that the localhost-only policy denies. A hand-rolled parse enforces nothing, so a cross-origin
 * `text/plain` POST — a simple request, no preflight, sent by every browser — would reach the
 * handler from any page the user has open. This router originally hand-rolled the parse and was
 * reachable exactly that way.
 */

import { Hono } from 'hono'
import { routeValidator } from '@localixai/plugin-sdk/backend'
import type { PluginRouteContext } from '@localixai/plugin-sdk/backend'
import type { AgentSessionsService } from './service'
import { toTranscriptTurns } from './transcript/to-agent-items'
import { itemsBodySchema, rosterBodySchema, statsBodySchema } from './route-schemas'

/**
 * A failure, said once and said the same way.
 *
 * This roster reads OTHER people's state directories, so what lands here is somebody else's raw
 * text — `EACCES: permission denied, open '/Users/…/.codex/sessions/rollout.jsonl'`. Echoed into
 * `error` it became the headline of a problem line across the panel. The sentence names what we
 * could not do; the driver's own words ride in `detail`, which is what the Event Center renders.
 */
function failure(what: string, error: unknown): { error: string; detail?: string } {
  const raw = error instanceof Error ? error.message : String(error)
  return { error: what, ...(raw ? { detail: raw } : {}) }
}

/**
 * The SDK's validator in its `text` envelope — `{ error: '<sentence>' }`: this router's client reads
 * `json.error` as text, and the summary OBJECT it once sent there rendered as "[object Object]".
 */
const validated = routeValidator({ envelope: 'text' })

export function createAgentSessionsRoutes(service: AgentSessionsService) {
  const app = new Hono<PluginRouteContext>()

  app.get('/providers', async (c) => {
    try {
      return c.json({ providers: await service.providers() })
    } catch (error) {
      return c.json(failure('Could not list the agent providers on this machine.', error), 500)
    }
  })

  /**
   * Which agent CLIs are installed here — the quick-action menu's whole input.
   *
   * A GET with a query flag rather than a POST: it mutates nothing, and the body-contract rule that
   * forces `validated('json')` exists to make a WRITE non-simple. `refresh` is the person pressing
   * "Check again"; anything other than `1` is the ordinary cached read, so a junk value degrades to
   * the safe answer instead of a 400.
   */
  app.get('/launchers', async (c) => {
    try {
      const refresh = c.req.query('refresh') === '1'
      return c.json({ launchers: await service.launchers({ refresh }) })
    } catch (error) {
      return c.json(failure('Could not check which agent CLIs are installed here.', error), 500)
    }
  })

  app.post('/roster', validated('json', rosterBodySchema), async (c) => {
    const input = c.req.valid('json')
    try {
      const rows = await service.roster(input.query ?? {}, input.localixSessionId)
      /**
       * `usage` is dropped on the WIRE, not in the fold.
       *
       * Measured on a real local history: a 200-row page is 245 KB and `usage` is 145 KB of it — 59% — because
       * every row carries a per-day, per-model token breakdown. Nothing that reads this response looks
       * at it: not the workspace row, not the tool's, not the resource tree. The statistics have their
       * own endpoint, which folds the same figures server-side and ships the result rather than the
       * material. So the roster refetched that weight on every filter change for nobody.
       *
       * Dropped here rather than in `buildRoster` so an in-process caller keeps the whole row; the cost
       * being paid is the HTTP one.
       */
      return c.json({
        ...rows,
        items: rows.items.map(({ usage: _usage, ...row }) => row),
      })
    } catch (error) {
      return c.json(failure('Could not read the agent roster on this machine.', error), 500)
    }
  })

  /**
   * The same transcript as `/transcript`, projected onto the native `AgentItem` model so a foreign
   * session renders in the transcript viewer we already have. `withheld`/`total` are the slice's,
   * not the projection's: the projection folds an adjacent call/result pair into one item, so
   * counting items here would report a smaller number than the events actually read.
   */
  app.post('/items', validated('json', itemsBodySchema), async (c) => {
    const { key, maxEvents, tail } = c.req.valid('json')
    try {
      const slice = await service.transcript(key, maxEvents, undefined, tail)
      if (!slice) return c.json({ error: 'no session on disk for that key' }, 404)
      return c.json({
        key: slice.key,
        turns: toTranscriptTurns(slice.events, slice.key),
        withheld: slice.withheld,
        total: slice.total,
        ...(slice.sourceTruncated ? { sourceTruncated: true } : {}),
      })
    } catch (error) {
      return c.json(failure('Could not read that agent session from disk.', error), 500)
    }
  })

  app.post('/stats', validated('json', statsBodySchema), async (c) => {
    try {
      return c.json(await service.stats(c.req.valid('json')))
    } catch (error) {
      return c.json(failure('Could not fold the agent history into statistics.', error), 500)
    }
  })

  return app
}
