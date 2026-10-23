import { Hono } from 'hono'
import type { Context } from 'hono'
import {
  defaultErrorHandler,
  routeValidator,
  type MiniAppRouteContext,
} from '@localixai/mini-app-sdk/backend'
import {
  batchRequestSchema,
  browseRequestSchema,
  connectRequestSchema,
  probeFileRequestSchema,
  queryRequestSchema,
  renameRequestSchema,
  updateConfigRequestSchema,
  validateRequestSchema,
} from './contracts'
import { probeDatabaseFile } from './probe-database-file'
import type { DbConnectionInfo, DbErrorResponse } from './contracts'
import { reviveBinaryParams } from './binary-params'
import { DbError, mapDbError, statementFailureOf, toErrorInfo } from './errors'
import type { DatabaseService } from './service'

/** Serialize any thrown value into the typed `{ error, code, detail }` body. */
function dbErrorBody(err: unknown): DbErrorResponse {
  const mapped = err instanceof DbError ? err : mapDbError(err)
  const info = toErrorInfo(mapped)
  const statement = statementFailureOf(mapped)
  return {
    error: info.message,
    code: info.code,
    detail: info.detail,
    ...(statement ? { statement } : {}),
  }
}

/**
 * A rejected request answers in the typed `DbErrorResponse` body (`{ error, code, detail }`)
 * every other failure here uses — the SDK's validator in its `flat` envelope.
 */
const validated = routeValidator({
  envelope: 'flat',
  code: 'invalid_request' satisfies DbErrorResponse['code'],
})

/**
 * The typed 404 for "no such connection / its driver is gone".
 *
 * Ten sites answered with a flat body whose `error` field held a bare machine token instead of a
 * sentence, and carried no `code` and no `detail` at all. The workbench renders `error` as the message
 * and maps its title from `code`, so the user saw that raw token inside the monospace ENGINE-OUTPUT
 * card, titled "Query failed" — for something that never reached the engine.
 */
function connectionNotFound(c: Context) {
  return c.json(dbErrorBody(new DbError('connection_not_found')), 404)
}

/** The shared happy/sad path of every handler that yields an updated connection:
 *  null → 404 `connection_not_found`, throw → typed 400, else `{ connection }`. */
async function connectionJson(c: Context, run: () => Promise<DbConnectionInfo | null>) {
  try {
    const info = await run()
    if (!info) return connectionNotFound(c)
    return c.json({ connection: info })
  } catch (err) {
    return c.json(dbErrorBody(err), 400)
  }
}

/**
 * SQL console + schema browser backend. Connections are per-user (registry keyed by
 * userId); every read/write is ownership-gated by the user identity injected into
 * the generic mini app route context by the host. Query
 * errors surface as 400 with the engine message so the console can render them.
 * Asking the agent about a query is a plain chat message (the console links the
 * connection as `@resource:` + the SQL into the composer) — there is no bespoke
 * aux-LLM text-to-SQL route here.
 */
export function createDatabaseRoutes(service: DatabaseService) {
  const app = new Hono<MiniAppRouteContext>()
  const uid = (c: Context<MiniAppRouteContext>) => c.env.userId

  const routes = app
    .get('/', async (c) => c.json({ connections: await service.list(uid(c)) }))
    .post('/connect', validated('json', connectRequestSchema), async (c) => {
      try {
        const info = await service.connect(uid(c), c.req.valid('json'))
        return c.json({ connection: info })
      } catch (err) {
        return c.json(dbErrorBody(err), 400)
      }
    })
    // Validate a config without saving it (connect form's "Test connection").
    .post('/test', validated('json', connectRequestSchema), async (c) => {
      try {
        const tested = await service.testConnection(uid(c), c.req.valid('json').config)
        return c.json({ ok: true, ...tested })
      } catch (err) {
        return c.json(dbErrorBody(err), 400)
      }
    })
    // Identify an on-disk database file (opening a `.db`/`.sqlite` from the
    // file tree, a drop, or an OS "Open with"). Reads a 16-byte header — strictly less
    // than `/connect`, which already accepts any absolute path as a SQLite `file`.
    // A file that is not a database answers 200 with `openable:false`: the tab renders
    // that as a sentence, and it is a fact about the file, not a request failure.
    .post('/probe-file', validated('json', probeFileRequestSchema), async (c) =>
      c.json(await probeDatabaseFile(c.req.valid('json').path)),
    )
    .post('/:id/disconnect', async (c) => {
      const ok = await service.disconnect(uid(c), c.req.param('id'))
      if (!ok) return connectionNotFound(c)
      return c.json({ disconnected: true })
    })
    .post('/:id/reconnect', (c) =>
      connectionJson(c, () => service.reconnect(uid(c), c.req.param('id'))),
    )
    .post('/:id/rename', validated('json', renameRequestSchema), async (c) => {
      const info = await service.rename(uid(c), c.req.param('id'), c.req.valid('json').name)
      if (!info) return connectionNotFound(c)
      return c.json({ connection: info })
    })
    // Return a saved connection's stored config to pre-fill the edit form. Ownership-gated;
    // tokens are returned as-stored (a vaulted `${secret:KEY}` stays a token, never resolved).
    .get('/:id/config', async (c) => {
      const res = await service.getConfig(uid(c), c.req.param('id'))
      if (!res) return connectionNotFound(c)
      return c.json(res)
    })
    // Edit a saved connection's config (+ name) in place, keeping its id. Validates the
    // new config like /connect, so a bad URL surfaces the engine error as a 400.
    .post('/:id/config', validated('json', updateConfigRequestSchema), (c) =>
      connectionJson(c, () => service.updateConfig(uid(c), c.req.param('id'), c.req.valid('json'))),
    )
    .post('/:id/remove', async (c) => {
      await service.remove(uid(c), c.req.param('id'))
      return c.json({ removed: true })
    })
    .post('/:id/query', validated('json', queryRequestSchema), async (c) => {
      const { sql, params, timeoutMs } = c.req.valid('json')
      try {
        const res = await service.query(
          uid(c),
          c.req.param('id'),
          sql,
          reviveBinaryParams(params),
          {
            timeoutMs,
          },
        )
        if (!res) return connectionNotFound(c)
        return c.json(res)
      } catch (err) {
        return c.json(dbErrorBody(err), 400)
      }
    })
    // Compile-only check of each top-level statement (never executes). A bad statement is a
    // 200 verdict, not a failed request; only an unknown connection is an error.
    .post('/:id/validate', validated('json', validateRequestSchema), async (c) => {
      const { sql } = c.req.valid('json')
      const res = await service.validate(uid(c), c.req.param('id'), sql, c.req.raw.signal)
      if (!res) return connectionNotFound(c)
      return c.json(res)
    })
    .post('/:id/browse', validated('json', browseRequestSchema), async (c) => {
      try {
        const res = await service.browse(uid(c), c.req.param('id'), c.req.valid('json'))
        if (!res) return connectionNotFound(c)
        return c.json(res)
      } catch (err) {
        return c.json(dbErrorBody(err), 400)
      }
    })
    // Apply several statements as ONE atomic transaction (grid row-editing "Commit").
    .post('/:id/batch', validated('json', batchRequestSchema), async (c) => {
      try {
        const statements = c.req.valid('json').statements.map((statement) => ({
          ...statement,
          params: reviveBinaryParams(statement.params),
        }))
        const res = await service.executeBatch(uid(c), c.req.param('id'), statements)
        if (!res) return connectionNotFound(c)
        return c.json(res)
      } catch (err) {
        return c.json(dbErrorBody(err), 400)
      }
    })
    // Manual-transaction controls ("Tx: Manual"). Begin opens a transaction the
    // subsequent /query calls run inside; commit/rollback close it. All return the updated
    // connection info (with `txOpen`) or a typed 400 (e.g. tx_unsupported).
    .post('/:id/tx/begin', (c) =>
      connectionJson(c, () => service.beginTx(uid(c), c.req.param('id'))),
    )
    .post('/:id/tx/commit', (c) =>
      connectionJson(c, () => service.commitTx(uid(c), c.req.param('id'))),
    )
    .post('/:id/tx/rollback', (c) =>
      connectionJson(c, () => service.rollbackTx(uid(c), c.req.param('id'))),
    )
    // Abort the in-flight queries on a connection (e.g. a hung SELECT the user gave up on).
    .post('/:id/cancel', async (c) => {
      const cancelled = service.cancel(uid(c), c.req.param('id'))
      return c.json({ cancelled })
    })
    // Health-check a connection; a dead one is dropped and reads as disconnected.
    .post('/:id/ping', async (c) => {
      const alive = await service.ping(uid(c), c.req.param('id'))
      return c.json({ alive })
    })
    .get('/:id/schemas', async (c) => {
      try {
        const res = await service.schemas(uid(c), c.req.param('id'))
        if (!res) return connectionNotFound(c)
        return c.json(res)
      } catch (err) {
        return c.json(dbErrorBody(err), 400)
      }
    })
    .get('/:id/columns', async (c) => {
      try {
        const res = await service.columnCatalog(uid(c), c.req.param('id'))
        if (!res) return connectionNotFound(c)
        return c.json(res)
      } catch (err) {
        return c.json(dbErrorBody(err), 400)
      }
    })
    .get('/:id/table/:table', async (c) => {
      const schema = c.req.query('schema')
      try {
        const res = await service.tableSchema(
          uid(c),
          c.req.param('id'),
          schema,
          c.req.param('table'),
        )
        if (!res) return connectionNotFound(c)
        return c.json(res)
      } catch (err) {
        return c.json(dbErrorBody(err), 400)
      }
    })

  routes.onError(defaultErrorHandler)
  return routes
}
