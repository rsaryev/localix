import { describe, expect, test } from 'bun:test'
import type { CallClass } from '@localixai/agent/agents'
import type { ConnectRequest, DbConnectionInfo } from './contracts'
import { buildConnectionConfig, inferEngine } from './db-connections'
import { createDatabaseTool, type DatabaseToolPorts } from './database-tool'
import {
  classifyDatabaseCall,
  databaseCallPaths,
  databaseToolSchema,
  type DatabaseToolInput,
} from './database-tool-schema'

function connection(overrides: Partial<DbConnectionInfo> = {}): DbConnectionInfo {
  return {
    id: 'c1',
    name: 'Shop',
    dialect: 'postgres',
    connected: true,
    readonly: false,
    createdAt: 0,
    ...overrides,
  } as DbConnectionInfo
}

function harness(saved: DbConnectionInfo[] = [connection()]) {
  const calls: string[] = []
  let connected: ConnectRequest | null = null
  const ports: DatabaseToolPorts = {
    query: {
      listConnections: async () => saved,
      runQuery: async (_u, _id, sql) => {
        calls.push(`query:${sql}`)
        return { columns: [{ name: 'n' }], rows: [[1]], durationMs: 1 }
      },
    },
    schema: {
      listConnections: async () => saved,
      schemas: async () => ({ public: [{ name: 'orders', type: 'table' }] }) as never,
      tableSchema: async () => null,
    },
    browse: {
      listConnections: async () => saved,
      browse: async () => {
        calls.push('browse')
        return { columns: [{ name: 'id' }], rows: [[1]], durationMs: 1 }
      },
    },
    connections: {
      list: async () => saved,
      connect: async (_u, req) => {
        connected = req
        return connection({ id: 'new', name: req.name ?? 'db', dialect: req.config.dialect })
      },
      test: async () => ({}),
      reconnect: async (_u, id) => (id === 'c1' ? connection() : null),
      disconnect: async (_u, id) => id === 'c1',
      remove: async (_u, id) => id === 'c1',
    },
  }
  const tool = createDatabaseTool({ userId: 'u', ports })
  const emitted: Array<{ miniApp: string; channel: string; payload: unknown }> = []
  const session = {
    emitCommand: (miniApp: string, channel: string, payload: unknown) =>
      emitted.push({ miniApp, channel, payload }),
  }
  const run = (input: Record<string, unknown>) =>
    tool.execute('t', databaseToolSchema.parse(input) as DatabaseToolInput, undefined, undefined, {
      session,
    } as never)
  return { tool, run, calls, emitted, connectedRequest: () => connected }
}

describe('the ONE database tool', () => {
  test('inspection is a read; connection management and non-read queries are writes', () => {
    expect(classifyDatabaseCall({ action: 'connections' })).toBe('read')
    expect(classifyDatabaseCall({ action: 'schema' })).toBe('read')
    expect(classifyDatabaseCall({ action: 'browse', table: 't' })).toBe('read')
    expect(classifyDatabaseCall({ action: 'test', url: 'postgres://h/db' })).toBe('read')
    expect(classifyDatabaseCall({ action: 'query', query: 'SELECT 1' })).toBe('read')
    expect(classifyDatabaseCall({ action: 'query', query: 'DELETE FROM t' })).toBe('write')
    for (const action of ['connect', 'reconnect', 'disconnect', 'remove']) {
      expect(classifyDatabaseCall({ action })).toBe('write')
    }
  })

  test.each([
    ['connections', { action: 'connections' }, { effect: 'read' }],
    ['schema', { action: 'schema' }, { effect: 'read' }],
    ['browse', { action: 'browse', table: 't' }, { effect: 'read' }],
    ['test', { action: 'test', url: 'postgres://h/db' }, { effect: 'read' }],
    ['read query', { action: 'query', query: 'SELECT 1' }, { effect: 'read' }],
    ['non-SQL read query', { action: 'query', query: 'GET user:1' }, { effect: 'read' }],
    [
      'write query',
      { action: 'query', query: 'DELETE FROM t' },
      { effect: 'external', irreversible: true },
    ],
    ['query without text', { action: 'query' }, { effect: 'external', irreversible: true }],
    ['connect', { action: 'connect', url: 'postgres://h/db' }, { effect: 'host' }],
    ['reconnect', { action: 'reconnect', connection_id: 'c1' }, { effect: 'host' }],
    ['disconnect', { action: 'disconnect', connection_id: 'c1' }, { effect: 'host' }],
    ['remove', { action: 'remove', connection_id: 'c1' }, { effect: 'host', irreversible: true }],
    ['unknown action', { action: 'vacuum' }, { effect: 'external' }],
    ['no input', undefined, { effect: 'external' }],
  ])('the permission class of %s', (_label, input, expected) => {
    const tool = createDatabaseTool({ userId: 'u', ports: {} as DatabaseToolPorts })
    expect(tool.classify!(input)).toEqual(expected as CallClass)
  })

  test('a query is classified truthfully both ways, whatever engine it targets', () => {
    // A read-only plan session denies every 'write' and trusts every 'read'.
    const cases: [string, 'read' | 'write'][] = [
      // previously refused: non-SQL reads went through the SQL classifier
      ['GET user:1', 'read'],
      ['SCAN 0 COUNT 50', 'read'],
      ['db.users.find({"active":true})', 'read'],
      ['products.search({"query":{"match_all":{}}})', 'read'],
      // previously waved through: writes performed by a function call inside a SELECT
      ["SELECT nextval('orders_id_seq')", 'write'],
      ['SELECT pg_terminate_backend(4242)', 'write'],
      ["SELECT dblink_exec('dbname=prod', 'DELETE FROM t')", 'write'],
      ['SELECT archive_old_orders()', 'write'],
      ["EXPLAIN ANALYZE SELECT setval('s', 1)", 'write'],
      // controls
      ['SELECT count(*), max(ts) FROM orders WHERE total > 5', 'read'],
      ['SET k v', 'write'],
      ['db.users.aggregate([{"$merge":"copy"}])', 'write'],
      ['UPDATE t SET a = 1', 'write'],
    ]
    for (const [query, verdict] of cases) {
      expect({ query, verdict: classifyDatabaseCall({ action: 'query', query }) }).toEqual({
        query,
        verdict,
      })
    }
  })

  test('declares the local database file connect/test can create, and nothing else', () => {
    expect(databaseCallPaths({ action: 'connect', file: '/data/app.db' })).toEqual(['/data/app.db'])
    expect(databaseCallPaths({ action: 'test', file: 'local.sqlite' })).toEqual(['local.sqlite'])
    expect(databaseCallPaths({ action: 'connect', url: 'file:///data/app.db' })).toEqual([
      '/data/app.db',
    ])
    expect(databaseCallPaths({ action: 'connect', file: ':memory:' })).toEqual([])
    expect(databaseCallPaths({ action: 'connect', url: 'postgres://h/db' })).toEqual([])
    expect(databaseCallPaths({ action: 'query', file: '/data/app.db' })).toEqual([])
    expect(databaseCallPaths(undefined)).toEqual([])
    const tool = createDatabaseTool({ userId: 'u', ports: {} as DatabaseToolPorts })
    expect(tool.permissionPaths?.({ action: 'connect', file: '/data/app.db' })).toEqual([
      '/data/app.db',
    ])
  })

  test('routes each verb to its body', async () => {
    const h = harness()
    await h.run({ action: 'query', query: 'SELECT 1' })
    await h.run({ action: 'browse', table: 'orders' })
    expect(h.calls).toEqual(['query:SELECT 1', 'browse'])
    const schema = await h.run({ action: 'schema', connection_id: 'c1' })
    expect(schema.content).toContain('orders')
  })

  test('a verb missing its subject says what to pass instead of failing inside the body', async () => {
    const h = harness()
    expect((await h.run({ action: 'browse' })).content).toBe(
      'action="browse" needs table (the object to sample).',
    )
    expect((await h.run({ action: 'remove' })).isError).toBe(true)
    expect((await h.run({ action: 'connect' })).content).toContain('needs a url, a file')
  })

  test('connect builds a validated config, keeps secret references, and names the new id', async () => {
    const h = harness()
    const result = await h.run({
      action: 'connect',
      host: 'db.internal',
      user: 'app',
      password: '${secret:SHOP_DB}',
      database: 'shop',
      engine: 'postgres',
      name: 'Shop prod',
      readonly: true,
    })
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('id: new')
    expect(h.connectedRequest()?.config).toMatchObject({
      dialect: 'postgres',
      password: '${secret:SHOP_DB}',
      readonly: true,
    })
    // The reply never echoes the credential.
    expect(result.content).not.toContain('SHOP_DB')
  })

  test('connections lists disconnected saved entries too, so the agent can reopen one', async () => {
    const h = harness([connection(), connection({ id: 'c2', name: 'Old', connected: false })])
    const result = await h.run({ action: 'connections' })
    expect(result.content).toContain('Old [postgres] — disconnected — id: c2')
    expect((await h.run({ action: 'reconnect', connection_id: 'nope' })).isError).toBe(true)
  })

  test('a successful write tells the workbench what moved; a read or a failure says nothing', async () => {
    const h = harness()
    await h.run({ action: 'connect', file: ':memory:' })
    await h.run({ action: 'query', connection_id: 'c1', query: 'CREATE TABLE t (id int)' })
    await h.run({ action: 'query', connection_id: 'c1', query: 'INSERT INTO t VALUES (1)' })
    await h.run({ action: 'query', query: 'DELETE FROM t' })
    // Reads, and a write that failed, move nothing the workbench shows.
    await h.run({ action: 'query', connection_id: 'c1', query: 'SELECT 1' })
    await h.run({ action: 'test', file: ':memory:' })
    await h.run({ action: 'reconnect', connection_id: 'nope' })
    expect(h.emitted).toEqual([
      { miniApp: 'database', channel: 'changes', payload: { type: 'connections' } },
      { miniApp: 'database', channel: 'changes', payload: { type: 'schema', connectionId: 'c1' } },
      { miniApp: 'database', channel: 'changes', payload: { type: 'data', connectionId: 'c1' } },
      { miniApp: 'database', channel: 'changes', payload: { type: 'data' } },
    ])
  })
})

describe('engine inference for connect/test', () => {
  test('a unique url scheme or a known file extension names the engine', () => {
    expect(inferEngine({ url: 'postgresql://h/db' })).toBe('postgres')
    expect(inferEngine({ url: 'mongodb+srv://c.example.net' })).toBe('mongodb')
    expect(inferEngine({ file: '/data/analytics.sqlite' })).toBe('sqlite')
    // A DuckDB file names no engine here, so it is not guessed to be SQLite.
    expect(inferEngine({ file: '/data/analytics.duckdb' })).toBeNull()
    expect(inferEngine({ file: ':memory:' })).toBe('sqlite')
  })

  test('http(s) is ClickHouse OR Elasticsearch, so the agent must say which', () => {
    expect(inferEngine({ url: 'https://search.internal:9200' })).toBeNull()
    const built = buildConnectionConfig(
      databaseToolSchema.parse({ action: 'connect', url: 'https://search.internal:9200' }),
    )
    expect(built.ok).toBe(false)
  })

  test('the service schema still judges the result (a url for the wrong engine is refused)', () => {
    const built = buildConnectionConfig(
      databaseToolSchema.parse({ action: 'connect', engine: 'mysql', url: 'postgres://h/db' }),
    )
    expect(built).toMatchObject({ ok: false })
  })

  // The permission layer checks `databaseCallPaths`, the connection opens what
  // `buildConnectionConfig` builds: two regex strips made them disagree (case, whitespace)
  // and both kept percent-escapes, so the checked path was not the file that opened.
  test('a file:// URL is decoded once, and permission and connection see the same path', () => {
    for (const url of ['file:///data/my%20app.db', ' FILE:///data/my%20app.db']) {
      expect(databaseCallPaths({ action: 'connect', url })).toEqual(['/data/my app.db'])
      const built = buildConnectionConfig(
        databaseToolSchema.parse({ action: 'connect', engine: 'sqlite', url }),
      )
      expect(built).toMatchObject({ ok: true, config: { file: '/data/my app.db' } })
    }
  })
})
