/**
 * The routes, exercised through Hono's own `app.request()` — no server, no port, and
 * mounted exactly as the backend-host does: a standalone app with request scope in `c.env`.
 * The regression this file pins: the routes must use the host-supplied user identity —
 * plus per-user ownership and the typed
 * `{ error, code }` failure body the UI branches on.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { Hono } from 'hono'
import type { DbDriver } from './drivers/port'
import { createSqliteDriver } from './drivers/sqlite'
import { createDatabaseRoutes } from './routes'
import { createDatabaseService, type DatabaseService } from './service'
import { createConnectionStore } from './store'

let dir: string

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'localix-db-routes-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A controllable in-memory driver (the `database.test.ts` fake, trimmed): `THROW <token>`
 *  rejects with a raw error carrying that code; anything else returns a single-cell row,
 *  so the connect-time SELECT 1 validation passes instantly. */
function fakeDriver(): DbDriver {
  const query: DbDriver['query'] = async (sql, params) => {
    const m = /^THROW (.+)$/.exec(sql)
    if (m) throw Object.assign(new Error(m[1]), { code: m[1] })
    if (sql === 'CHECK BINARY PARAM') {
      const value = params?.[0]
      return {
        columns: [{ name: 'is_buffer' }, { name: 'bytes' }],
        rows: [[Buffer.isBuffer(value), value instanceof Uint8Array ? [...value] : null]],
        durationMs: 0,
      }
    }
    if (sql === 'SELECT PARAMS')
      return { columns: [{ name: 'params' }], rows: [params ?? []], durationMs: 0 }
    return { columns: [{ name: 'n' }], rows: [[1]], durationMs: 0 }
  }

  return {
    getFlags: () => ({
      dialect: 'sqlite',
      kind: 'sql',
      supportsMultipleSchemas: false,
      supportsReturning: true,
      supportsCancel: true,
      defaultSchema: 'main',
    }),
    query,
    async transaction(statements) {
      const results = []
      for (const statement of statements) {
        results.push(await query(statement.sql, statement.params))
      }
      return results
    },
    async browse(request) {
      return {
        columns: [{ name: 'object' }, { name: 'offset' }],
        rows: [[request.table, request.offset]],
        durationMs: 0,
      }
    },
    async schemas() {
      return {}
    },
    async tableSchema(_schema, table) {
      if (table === 'BOOM') throw new Error('introspection blew up')
      return {
        name: table,
        type: 'table',
        columns: [],
        primaryKey: [],
        foreignKeys: [],
        indexes: [],
      }
    },
    async close() {},
  }
}

const newService = (createDriver: () => DbDriver = fakeDriver) =>
  createDatabaseService({
    store: createConnectionStore({
      dir: path.join(dir, `store-${Math.random().toString(36).slice(2)}`),
    }),
    createDriver,
  })

/**
 * Mount the routes as the host does and supply the per-request MiniAppRouteScope as Hono env.
 */
function harness(service: DatabaseService, userId = 'user-a') {
  const app = new Hono()
  app.route('/rpc/database', createDatabaseRoutes(service) as never)
  const call = (routePath: string, init?: RequestInit) => {
    // Bare '/' maps to the mount path itself (Hono's strict matching).
    return app.request(`/rpc/database${routePath === '/' ? '' : routePath}`, init, {
      userId,
      projectId: '',
      cwd: dir,
    })
  }
  const post = (routePath: string, body: unknown) =>
    call(routePath, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  return { call, post }
}

const sqliteConfig = { config: { dialect: 'sqlite', file: ':memory:' } }

describe('user resolution + ownership', () => {
  it('POST /connect persists under the request user, and GET / lists only that user', async () => {
    const service = newService()
    const a = harness(service, 'user-a')

    const connected = await a.post('/connect', sqliteConfig)
    expect(connected.status).toBe(200)
    const { connection } = (await connected.json()) as { connection: { id: string } }
    expect(connection.id).toBeTruthy()

    // Persisted under the host-resolved user — the service sees it under 'user-a' only.
    expect((await service.list('user-a')).map((c) => c.id)).toEqual([connection.id])
    expect(await service.list('user-b')).toEqual([])

    const listed = await a.call('/')
    expect(listed.status).toBe(200)
    const body = (await listed.json()) as { connections: { id: string }[] }
    expect(body.connections.map((c) => c.id)).toEqual([connection.id])

    // A harness planted as another user sees NOTHING of user-a's connections.
    const b = harness(service, 'user-b')
    expect(((await (await b.call('/')).json()) as { connections: unknown[] }).connections).toEqual(
      [],
    )

    await service.closeAll()
  })
})

describe('failure bodies', () => {
  it('POST /:id/query is a 404 whose body follows the typed contract', async () => {
    // INTENTIONAL CHANGE. This used to assert `error === 'connection_not_found'`, i.e. it pinned a
    // machine CODE sitting in the field that carries the human message — with no `code` at all. The
    // workbench reads `error` as the message and maps its title from `code`, so a user saw the literal
    // token `connection_not_found` inside the monospace ENGINE-OUTPUT card, titled "Query failed" for
    // something that never reached the engine. Nine routes answered that way.
    const { post } = harness(newService())
    const res = await post('/nope/query', { sql: 'SELECT 1' })
    expect(res.status).toBe(404)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('connection_not_found')
    // A sentence, not a token: the UI shows this verbatim.
    expect(body.error).toContain('no longer available')
    expect(body.error).not.toBe('connection_not_found')
  })

  it('every connection-missing route answers that same body, not just the query one', async () => {
    // The flat form was copy-pasted across ten sites; one owner now serves them all, and this is the
    // check that a second one cannot drift back in unnoticed.
    const { call, post } = harness(newService())
    const responses = [
      await call('/nope/schemas'),
      await call('/nope/table/users'),
      await post('/nope/disconnect', {}),
    ]
    for (const res of responses) {
      expect(res.status).toBe(404)
      const body = (await res.json()) as { error: string; code: string }
      expect(body.code).toBe('connection_not_found')
      expect(body.error).not.toBe('connection_not_found')
    }
  })

  it('a driver error surfaces as 400 with the typed { error, code } body', async () => {
    const service = newService()
    const { post } = harness(service)
    const { connection } = (await (await post('/connect', sqliteConfig)).json()) as {
      connection: { id: string }
    }

    const res = await post(`/${connection.id}/query`, { sql: 'THROW ECONNREFUSED' })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; code: string }
    expect(body.code).toBe('host_unreachable')
    expect(body.error).toBeTruthy()

    await service.closeAll()
  })

  it('an introspection failure on /:id/table/:table carries the same typed body', async () => {
    const service = newService()
    const { call, post } = harness(service)
    const { connection } = (await (await post('/connect', sqliteConfig)).json()) as {
      connection: { id: string }
    }

    const res = await call(`/${connection.id}/table/BOOM`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; code: string; detail?: string }
    expect(body.code).toBe('query_failed') // mapDbError's fallback for an arbitrary throw
    expect(body.detail).toContain('introspection blew up') // the raw message rides in `detail`

    await service.closeAll()
  })

  it('an introspection failure on /:id/schemas carries the same typed body', async () => {
    const service = newService(() => ({
      ...fakeDriver(),
      async schemas() {
        throw new Error('catalog lookup blew up')
      },
    }))
    const { call, post } = harness(service)
    const { connection } = (await (await post('/connect', sqliteConfig)).json()) as {
      connection: { id: string }
    }

    const res = await call(`/${connection.id}/schemas`)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string; code: string; detail?: string }
    expect(body.code).toBe('query_failed')
    expect(body.detail).toContain('catalog lookup blew up')

    await service.closeAll()
  })
})

describe('structured browse route', () => {
  it('validates and forwards a bounded object page', async () => {
    const service = newService()
    const { post } = harness(service)
    const { connection } = (await (await post('/connect', sqliteConfig)).json()) as {
      connection: { id: string }
    }
    const response = await post(`/${connection.id}/browse`, {
      table: 'users',
      limit: 50,
      offset: 100,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { rows: unknown[][] } }
    expect(body.result.rows).toEqual([['users', 100]])

    const invalid = await post(`/${connection.id}/browse`, {
      table: 'users',
      limit: 50_000,
      offset: 0,
    })
    expect(invalid.status).toBe(400)
    await service.closeAll()
  })
})

describe('parameterized batch route', () => {
  it('validates and forwards params with each statement', async () => {
    const service = newService()
    const { post } = harness(service)
    const { connection } = (await (await post('/connect', sqliteConfig)).json()) as {
      connection: { id: string }
    }

    const response = await post(`/${connection.id}/batch`, {
      statements: [{ sql: 'SELECT PARAMS', params: ["value with ' and \\\\"] }],
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { results: Array<{ rows: unknown[][] }> }
    expect(body.results[0]?.rows).toEqual([["value with ' and \\\\"]])

    const legacyStringBatch = await post(`/${connection.id}/batch`, {
      statements: ['SELECT 1'],
    })
    expect(legacyStringBatch.status).toBe(400)
    await service.closeAll()
  })

  it('revives a JSON-transported Buffer before native driver binding', async () => {
    const service = newService()
    const { post } = harness(service)
    const { connection } = (await (await post('/connect', sqliteConfig)).json()) as {
      connection: { id: string }
    }

    const response = await post(`/${connection.id}/batch`, {
      statements: [
        {
          sql: 'CHECK BINARY PARAM',
          params: [{ type: 'Buffer', data: [0x00, 0xff, 0x1a] }],
        },
      ],
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { results: Array<{ rows: unknown[][] }> }
    expect(body.results[0]?.rows).toEqual([[true, [0x00, 0xff, 0x1a]]])

    await service.closeAll()
  })
})

describe('database-file probe route', () => {
  // Opening a `.db` from the file tree / Finder goes through here BEFORE `/connect`,
  // so that a file which merely ends in `.db` never becomes a saved connection.
  it('identifies a real SQLite file and refuses a lookalike', async () => {
    const service = newService()
    const { post } = harness(service)

    const real = path.join(dir, 'probe-route.db')
    const db = new Database(real)
    db.run('CREATE TABLE t (a INTEGER)')
    db.close()
    const okResponse = await post('/probe-file', { path: real })
    expect(okResponse.status).toBe(200)
    expect(await okResponse.json()).toEqual({ openable: true, dialect: 'sqlite' })

    const impostor = path.join(dir, 'probe-route-fake.db')
    await writeFile(impostor, 'not a database\n')
    const badResponse = await post('/probe-file', { path: impostor })
    expect(badResponse.status).toBe(200)
    expect(await badResponse.json()).toEqual({
      openable: false,
      reason: 'unrecognized-format',
    })

    await service.closeAll()
  })

  it('rejects a relative path with the typed 400 body', async () => {
    // A relative path would resolve against the server's cwd — a different file from
    // the one the user clicked. The route says so in the shape the UI already renders.
    const service = newService()
    const { post } = harness(service)

    const response = await post('/probe-file', { path: 'relative/app.db' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'invalid_request' })

    await service.closeAll()
  })
})

describe('scripts and validation over the wire', () => {
  const sqliteService = () => newService(() => createSqliteDriver({ file: ':memory:' }))

  it('POST /:id/query reports the statement count, and a failure names its statement', async () => {
    const service = sqliteService()
    const { post } = harness(service)
    const { connection } = (await (await post('/connect', sqliteConfig)).json()) as {
      connection: { id: string }
    }
    const ok = await post(`/${connection.id}/query`, {
      sql: 'CREATE TABLE t(a INTEGER); INSERT INTO t VALUES (1)',
    })
    expect(await ok.json()).toMatchObject({ statements: { total: 2, executed: 2 } })

    const failed = await post(`/${connection.id}/query`, {
      sql: 'INSERT INTO t VALUES (2); INSERT INTO nope VALUES (1)',
    })
    expect(failed.status).toBe(400)
    expect(await failed.json()).toMatchObject({
      code: 'query_failed',
      statement: { index: 1, total: 2, executed: 1, start: 26 },
    })
    await service.closeAll()
  })

  it('POST /:id/validate answers per-statement verdicts, and 404 for an unknown connection', async () => {
    const service = sqliteService()
    const { post } = harness(service)
    const { connection } = (await (await post('/connect', sqliteConfig)).json()) as {
      connection: { id: string }
    }
    const res = await post(`/${connection.id}/validate`, { sql: 'SELECT 1; SELEC 2' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({
      supported: true,
      results: [
        { statementStart: 0, ok: true },
        { statementStart: 10, ok: false, offset: 10 },
      ],
    })
    expect((await post('/nope/validate', { sql: 'SELECT 1' })).status).toBe(404)
    await service.closeAll()
  })
})
