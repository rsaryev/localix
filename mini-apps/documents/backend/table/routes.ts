import { Hono } from 'hono'
import { validated } from '../validator'
import type { PageSpec } from '@localixai/dataview'
import type { Context } from 'hono'
import {
  defaultErrorHandler,
  jsonError,
  type MiniAppRouteContext,
} from '@localixai/mini-app-sdk/backend'
import { exportQuerySchema, ingestBodySchema, openBodySchema, rowsQuerySchema } from './contracts'
import type { TableService } from './service'

/**
 * Inspector Table tab data + export + "open in native app".
 * Rows are paged/sorted/filtered server-side (large tables never hit the client at
 * once); meta is small and restorable. Ownership-gated by userId on every read.
 */
/**
 * The typed 404 for a table id this user has no row for.
 *
 * Three routes answered `c.json({ error: 'table_not_found' }, 404)`. These routers mount
 * `defaultErrorHandler`, i.e. the SDK envelope `{error:{code,message}}`, and the inspector reads
 * `error.error.message` through `unwrap` — so against a FLAT body that read is `undefined` and the
 * user got "Request failed with status 404" with the reason gone entirely.
 */
/** Why an ingest was refused, in words. Keyed by the service's own code. */
const INGEST_REFUSAL: Record<string, string> = {
  not_tabular: 'There is no table in this file — nothing tabular could be read out of it.',
  ingest_unavailable: 'This build cannot ingest tables.',
  ingest_failed: 'This file could not be read as a table.',
}

/** Why opening a table in another application was refused. */
const OPEN_REFUSAL: Record<string, string> = {
  unsupported_platform: 'This platform has no application to open a table in.',
  table_not_found: 'That table is no longer available — reopen it from the file or re-ingest it.',
  target_unavailable: 'That application is not available on this machine.',
  host_files_unavailable: 'This build cannot write the file another application would open.',
  no_exporter: 'This table cannot be written in that format.',
  open_failed: 'That table could not be handed to another application.',
}

/**
 * The sentence for a refusal code. The fallback matters: an unmapped code used to leave `message`
 * UNDEFINED on the wire, so the client rendered nothing at all where the reason belongs.
 */
const refusalSentence = (table: Record<string, string>, code: string) =>
  table[code] ?? 'That did not work. The details say what the reader reported.'

function tableNotFound(c: Context) {
  return jsonError(
    c,
    404,
    'table_not_found',
    'That table is no longer available — reopen it from the file or re-ingest it.',
  )
}

export function createTableRoutes(service: TableService) {
  const app = new Hono<MiniAppRouteContext>()

  const routes = app
    // Static routes registered before `/:id` so they aren't captured as an id.
    .get('/open-targets', (c) => c.json({ targets: service.openTargets() }))
    // Open a spreadsheet file as a persisted table (server extracts + saves).
    .post('/ingest', validated('json', ingestBodySchema), async (c) => {
      const { sessionId, path, mediaId, name, format } = c.req.valid('json')
      const res = await service.ingest(c.env.userId, sessionId, { path, mediaId, name, format })
      if ('error' in res) {
        // A CODE in the `error` field is not a message: read through `unwrap` it is `undefined`,
        // and the person was told "Request failed with status 400" — the same defect the 404 above
        // documents. Every refusal names itself in words.
        // 503, not 501: the envelope's status union is what the host's error contract allows, and
        // "this build has no ingest port" is an unavailable service either way.
        const status = res.error === 'ingest_unavailable' ? 503 : 400
        return jsonError(
          c,
          status,
          res.error,
          refusalSentence(INGEST_REFUSAL, res.error),
          res.detail,
        )
      }
      return c.json(res)
    })
    .get('/:id/rows', validated('query', rowsQuerySchema), async (c) => {
      const q = c.req.valid('query')
      const spec: PageSpec = {
        offset: q.offset ?? 0,
        limit: q.limit ?? 100,
        sort: q.sort ? { columnId: q.sort, dir: q.dir ?? 'asc' } : undefined,
        filter: q.q ? { query: q.q, columnId: q.qcol } : undefined,
      }
      const page = await service.page(c.env.userId, c.req.param('id'), spec)
      if (!page) return tableNotFound(c)
      return c.json(page)
    })
    .get('/:id/export', validated('query', exportQuerySchema), async (c) => {
      const res = await service.exportTable(
        c.env.userId,
        c.req.param('id'),
        c.req.valid('query').format,
      )
      if (!res) return tableNotFound(c)
      // Bun's Response accepts string | Uint8Array; the DOM BodyInit type omits the
      // plain Uint8Array case, so assert it (CSV is a string; binary formats arrive later).
      return new Response(res.body as BodyInit, {
        headers: {
          'Content-Type': `${res.mimeType}; charset=utf-8`,
          'Content-Disposition': `attachment; filename="${res.filename}"`,
          'Cache-Control': 'no-store',
        },
      })
    })
    .post('/:id/open', validated('json', openBodySchema), async (c) => {
      const result = await service.open(
        c.env.userId,
        c.req.param('id'),
        c.req.valid('json').targetId,
      )
      if ('error' in result)
        return jsonError(
          c,
          400,
          result.error,
          refusalSentence(OPEN_REFUSAL, result.error),
          result.detail,
        )
      return c.json(result)
    })
    .get('/:id', async (c) => {
      const meta = await service.getMeta(c.env.userId, c.req.param('id'))
      if (!meta) return tableNotFound(c)
      return c.json(meta)
    })

  routes.onError(defaultErrorHandler)
  return routes
}
