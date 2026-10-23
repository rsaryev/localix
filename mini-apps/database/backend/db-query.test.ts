import { describe, expect, it } from 'bun:test'
import { createDbQueryTool, type DbQueryPort } from './db-query'

function port(overrides: Partial<DbQueryPort> = {}): DbQueryPort {
  return {
    listConnections: async () => [
      { id: 'c1', name: 'app.db', dialect: 'sqlite', connected: true, readonly: false },
    ],
    runQuery: async () => ({
      columns: [{ name: 'id' }, { name: 'name' }],
      rows: [
        [1, 'Ada'],
        [2, 'Zoe'],
      ],
      durationMs: 3,
    }),
    ...overrides,
  }
}

const run = (p: DbQueryPort, input: { query: string; connection_id?: string }) =>
  createDbQueryTool({ userId: 'u', port: p }).execute('t', input)

describe('db_query tool', () => {
  it('classifies reads as reads and every unproven query as an irreversible external write', () => {
    const tool = createDbQueryTool({ userId: 'u1', port: {} as never })
    expect(tool.mutates).toBe(true)
    const verdict = (query: unknown) => tool.classify!({ query })

    for (const query of [
      'SELECT * FROM users LIMIT 5',
      '  select 1',
      'WITH a AS (SELECT 1) SELECT * FROM a',
      'GET user:1',
      'db.users.find({})',
    ]) {
      expect({ query, verdict: verdict(query) }).toEqual({ query, verdict: { effect: 'read' } })
    }

    for (const query of [
      'DROP TABLE users',
      'INSERT INTO t VALUES (1)',
      'UPDATE t SET x = 1',
      'SELECT 1; DROP TABLE t',
      "SELECT nextval('s')",
      '',
      undefined,
    ]) {
      expect({ query, verdict: verdict(query) }).toEqual({
        query,
        verdict: { effect: 'external', irreversible: true },
      })
    }
  })

  it('renders a text table for row results', async () => {
    const r = await run(port(), { query: 'SELECT * FROM users' })
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('id')
    expect(r.content).toContain('Ada')
    expect(r.content).toContain('2 row(s)')
  })

  it('says a capped result is the FIRST rows of a larger one, not its size', async () => {
    const rows = Array.from({ length: 60 }, (_, i) => [i, `n${i}`])
    const r = await run(
      port({
        runQuery: async () => ({
          columns: [{ name: 'id' }, { name: 'name' }],
          rows,
          durationMs: 2,
          truncated: true,
        }),
      }),
      { query: 'SELECT * FROM big' },
    )
    expect(r.content).toContain('The first 60 rows (the result has more')
    expect(r.content).not.toContain('60 row(s)')
    expect((r.details as { truncated?: boolean }).truncated).toBe(true)
  })

  it('reports affected rows for DML', async () => {
    const r = await run(
      port({ runQuery: async () => ({ columns: [], rows: [], rowsAffected: 5, durationMs: 1 }) }),
      { query: 'DELETE FROM users' },
    )
    expect(r.content).toContain('5 row(s) affected')
  })

  it('errors when nothing is connected', async () => {
    const r = await run(port({ listConnections: async () => [] }), { query: 'SELECT 1' })
    expect(r.isError).toBe(true)
    expect(r.content).toContain('No database is connected')
  })

  it('requires connection_id when multiple are connected', async () => {
    const r = await run(
      port({
        listConnections: async () => [
          { id: 'a', name: 'one', dialect: 'sqlite', connected: true, readonly: false },
          { id: 'b', name: 'two', dialect: 'postgres', connected: true, readonly: false },
        ],
      }),
      { query: 'SELECT 1' },
    )
    expect(r.isError).toBe(true)
    expect(r.content).toContain('connection_id')
  })

  it('runs a non-SQL (Redis/Mongo/ES) connection instead of refusing it', async () => {
    const r = await run(
      port({
        listConnections: async () => [
          { id: 'r', name: 'cache', dialect: 'redis', connected: true, readonly: false },
        ],
        runQuery: async () => ({ columns: [{ name: 'value' }], rows: [['hello']], durationMs: 1 }),
      }),
      { query: 'GET greeting' },
    )
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('[redis]')
    expect(r.content).toContain('hello')
  })

  it('runs a read against a read-only non-SQL connection (the service enforces per command)', async () => {
    // The tool used to refuse every non-SQL read-only connection outright, because
    // read-only was only enforced for SQL. Now each engine has its own classifier
    // (`../read-only`) and the service gates every caller per command — so a READ here is
    // allowed, and a write is rejected by the service with `readonly_blocked` rather than
    // by a blanket refusal here.
    const r = await run(
      port({
        listConnections: async () => [
          { id: 'r', name: 'cache', dialect: 'redis', connected: true, readonly: true },
        ],
      }),
      { query: 'GET greeting' },
    )
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('[redis]')
  })

  it('requires connection_id when several engines are connected (no SQL preference)', async () => {
    const r = await run(
      port({
        listConnections: async () => [
          { id: 'r', name: 'cache', dialect: 'redis', connected: true, readonly: false },
          { id: 's', name: 'app', dialect: 'postgres', connected: true, readonly: false },
        ],
      }),
      { query: 'SELECT 1' },
    )
    expect(r.isError).toBe(true)
    expect(r.content).toContain('connection_id')
  })

  it('surfaces a query error', async () => {
    const r = await run(
      port({
        runQuery: async () => {
          throw new Error('syntax error near SELCT')
        },
      }),
      { query: 'SELCT 1' },
    )
    expect(r.isError).toBe(true)
    expect(r.content).toContain('syntax error')
  })

  it('surfaces the dialect in the result so the agent can write dialect-correct SQL', async () => {
    const r = await run(port(), { query: 'SELECT * FROM users' })
    expect(r.content).toContain('[sqlite]')
    expect((r.details as { dialect?: string })?.dialect).toBe('sqlite')
  })

  it('renders binary (bytea/BLOB) as hex, not the internal Buffer JSON', async () => {
    const r = await run(
      port({
        runQuery: async () => ({
          columns: [{ name: 'data' }],
          rows: [[new Uint8Array([0xde, 0xad, 0xbe, 0xef])]],
          durationMs: 2,
        }),
      }),
      { query: 'SELECT data FROM files' },
    )
    expect(r.isError).toBeFalsy()
    expect(r.content).toContain('\\xdeadbeef')
    expect(r.content).not.toContain('Buffer')
    expect(r.content).not.toContain('"data":[')
  })

  it("hands the run's abort signal to the port, so a stopped turn stops its statement", async () => {
    // Dropped, a stopped turn left the statement — possibly a write — running for up to 30s.
    let seen: AbortSignal | undefined
    const controller = new AbortController()
    await createDbQueryTool({
      userId: 'u',
      port: port({
        runQuery: async (_u, _id, _sql, signal) => {
          seen = signal
          return { columns: [], rows: [], durationMs: 0 }
        },
      }),
    }).execute('t', { query: 'SELECT 1' }, controller.signal)
    expect(seen).toBe(controller.signal)
  })
})
