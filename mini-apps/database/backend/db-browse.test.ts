import { describe, expect, it } from 'bun:test'
import { createDbBrowseTool, type DbBrowsePort } from './db-browse'

function port(overrides: Partial<DbBrowsePort> = {}): DbBrowsePort {
  return {
    listConnections: async () => [
      { id: 'c1', name: 'app', dialect: 'postgres', connected: true, readonly: false },
    ],
    browse: async () => ({
      columns: [{ name: 'id' }, { name: 'email' }],
      rows: [[1, 'ada@example.com']],
      durationMs: 3,
    }),
    ...overrides,
  }
}

const run = (
  p: DbBrowsePort,
  input: {
    table: string
    schema?: string
    connection_id?: string
    limit?: number
    offset?: number
    sort_column?: string
    sort_direction?: 'asc' | 'desc'
  },
) =>
  createDbBrowseTool({ userId: 'u', port: p }).execute('t', {
    limit: 20,
    offset: 0,
    sort_direction: 'asc',
    ...input,
  })

describe('db_browse tool', () => {
  it('samples a qualified object through the structured port', async () => {
    let request:
      | {
          table: string
          schema?: string
          limit: number
          offset: number
          sort?: { column: string; direction: 'asc' | 'desc' }
        }
      | undefined
    const result = await run(
      port({
        browse: async (_userId, _connectionId, next) => {
          request = next
          return {
            columns: [{ name: 'id' }, { name: 'email' }],
            rows: [[1, 'ada@example.com']],
            durationMs: 3,
          }
        },
      }),
      {
        table: 'users',
        schema: 'public',
        limit: 10,
        offset: 20,
        sort_column: 'email',
        sort_direction: 'desc',
      },
    )
    expect(result.isError).toBeFalsy()
    expect(request).toEqual({
      table: 'users',
      schema: 'public',
      limit: 10,
      offset: 20,
      sort: { column: 'email', direction: 'desc' },
    })
    expect(result.content).toContain('public.users')
    expect(result.content).toContain('ada@example.com')
  })

  it('uses bounded defaults and rejects connection ambiguity', async () => {
    let request: { limit: number; offset: number } | undefined
    const single = await run(
      port({
        browse: async (_userId, _connectionId, next) => {
          request = next
          return { columns: [], rows: [], durationMs: 1 }
        },
      }),
      { table: 'users' },
    )
    expect(single.isError).toBeFalsy()
    expect(request).toMatchObject({ limit: 20, offset: 0 })

    const ambiguous = await run(
      port({
        listConnections: async () => [
          { id: 'a', name: 'one', dialect: 'sqlite', connected: true, readonly: false },
          { id: 'b', name: 'two', dialect: 'postgres', connected: true, readonly: false },
        ],
      }),
      { table: 'users' },
    )
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.content).toContain('connection_id')
  })

  it("hands the run's abort signal to the port, so a stopped turn stops its read", async () => {
    let seen: AbortSignal | undefined
    const controller = new AbortController()
    await createDbBrowseTool({
      userId: 'u',
      port: port({
        browse: async (_u, _id, _request, signal) => {
          seen = signal
          return { columns: [], rows: [], durationMs: 0 }
        },
      }),
    }).execute(
      't',
      { table: 'users', limit: 20, offset: 0, sort_direction: 'asc' },
      controller.signal,
    )
    expect(seen).toBe(controller.signal)
  })
})
