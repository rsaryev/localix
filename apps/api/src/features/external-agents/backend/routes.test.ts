/**
 * The routes, exercised through Hono's own `app.request()` — no server and no port, mounted the way
 * the backend host mounts them (the pattern in plugins/database/backend/routes.test.ts).
 *
 * What this pins: `/items` is the ONLY transcript route the plugin exposes, so every reading a human
 * gets — the preview and the durable import — comes through it. A field the schema accepts and the
 * handler forgets to thread is invisible from both ends: the request validates, the answer looks
 * right, and it is the wrong half of the session.
 */

import { describe, expect, it } from 'bun:test'

import { createAgentSessionsRoutes } from './routes'
import type { AgentSessionsService } from './service'

function appWith(record: (args: unknown[]) => void) {
  const service = {
    async transcript(...args: unknown[]) {
      record(args)
      return {
        key: 'codex:s1',
        summary: {
          key: 'codex:s1',
          provider: 'codex',
          nativeSessionId: 's1',
          title: 'session',
          updatedAt: 0,
          sourcePath: '/tmp/s1.jsonl',
        },
        events: [],
        withheld: 7,
        total: 7,
      }
    },
  } as unknown as AgentSessionsService
  return createAgentSessionsRoutes(service, async () => [
    { id: 'codex', name: 'Codex', command: 'codex' },
  ])
}

async function items(body: Record<string, unknown>) {
  const calls: unknown[][] = []
  const res = await appWith((args) => calls.push(args)).request('/items', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, args: calls[0] }
}

describe('/items reads the end of a session when asked', () => {
  it('does not expose the obsolete CLI launcher probe', async () => {
    const res = await appWith(() => {}).request('/launchers')
    expect(res.status).toBe(404)
  })
  it('threads tail through to the adapter read', async () => {
    const { status, args } = await items({ key: 'codex:s1', maxEvents: 50, tail: true })

    expect(status).toBe(200)
    // transcript(key, maxEvents, maxCharsPerEvent, tail) — the fourth slot is the one that decides
    // which half of a capped session a reader is shown.
    expect(args?.[0]).toBe('codex:s1')
    expect(args?.[1]).toBe(50)
    expect(args?.[3]).toBe(true)
  })

  it('includes the adapter-supported native continuation in the transcript response', async () => {
    const response = await appWith(() => {}).request('/items', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'codex:s1' }),
    })
    expect((await response.json()).resume).toEqual({
      providerName: 'Codex',
      command: "codex resume 's1'",
    })
  })

  it('leaves the opening as the default when nothing asks for the end', async () => {
    const { args } = await items({ key: 'codex:s1' })

    expect(args?.[3]).toBeUndefined()
  })

  it('rejects a non-boolean tail rather than reading some coerced end', async () => {
    const { status } = await items({ key: 'codex:s1', tail: 'yes' })

    expect(status).toBe(400)
  })
})

describe('the roster wire carries what its readers read', () => {
  /**
   * Measured on a real local history: a 200-row page was 245 KB and `usage` was 145 KB of it — 59% — because
   * every row carried a per-day, per-model token breakdown that nothing reading this response looks at.
   * The workspace row shows a title, a mark, a state and a time; the tool's row shows the same plus an
   * event count; the statistics have their own endpoint that folds server-side. Dropping it took the
   * page to 98.6 KB, on every filter change.
   */
  function rosterApp(row: Record<string, unknown>) {
    const service = {
      async roster() {
        return { items: [row], total: 1, withheld: 0 }
      },
    } as unknown as AgentSessionsService
    return createAgentSessionsRoutes(service, async () => [
      { id: 'codex', name: 'Codex', command: 'codex' },
    ])
  }

  const ROW = {
    key: 'codex:a',
    provider: 'codex',
    nativeSessionId: 'a',
    title: 'session',
    cwd: '/work/app',
    updatedAt: 1,
    messageCount: 12,
    sourcePath: '/tmp/a.jsonl',
    state: 'idle',
    authority: 'none',
    usage: {
      inputTokens: 1,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1,
      reasoningTokens: 0,
      totalTokens: 2,
      requests: 1,
      byModel: [
        {
          model: 'm',
          inputTokens: 1,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 1,
          reasoningTokens: 0,
          totalTokens: 2,
          requests: 1,
        },
      ],
      byDay: [
        {
          day: '2026-08-06',
          byModel: [],
          inputTokens: 1,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 1,
          reasoningTokens: 0,
          totalTokens: 2,
          requests: 1,
        },
      ],
    },
  }

  async function fetchRoster(row: Record<string, unknown>) {
    const res = await rosterApp(row).request('/roster', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: {} }),
    })
    return (await res.json()) as { items: Record<string, unknown>[] }
  }

  it('drops the token breakdown nothing on this response reads', async () => {
    const body = await fetchRoster(ROW)

    expect('usage' in (body.items[0] ?? {})).toBe(false)
  })

  it('keeps every field a row is actually rendered from', async () => {
    const body = await fetchRoster(ROW)

    // The workspace row and the tool's row between them read all of these.
    expect(body.items[0]).toMatchObject({
      key: 'codex:a',
      provider: 'codex',
      title: 'session',
      cwd: '/work/app',
      messageCount: 12,
      state: 'idle',
      sourcePath: '/tmp/a.jsonl',
    })
  })

  it('leaves the bounds alone, since a caller pages on them', async () => {
    const body = (await fetchRoster(ROW)) as unknown as { total: number; withheld: number }

    expect(body.total).toBe(1)
    expect(body.withheld).toBe(0)
  })
})

describe('a filter the schema does not declare is dropped before it reaches the fold', () => {
  /**
   * Zod strips unknown keys, so a query field wired everywhere else but missing from the route
   * schema fails SILENTLY: the request validates, the answer is a correct answer to a different
   * question, and only the count gives it away. `model` is the newest of them.
   */
  async function seenBy(route: '/roster' | '/stats', body: Record<string, unknown>) {
    const calls: unknown[] = []
    const service = {
      async roster(query: unknown) {
        calls.push(query)
        return { items: [], total: 0, withheld: 0 }
      },
      async stats(query: unknown) {
        calls.push(query)
        return { sessions: 0 }
      },
    } as unknown as AgentSessionsService
    const res = await createAgentSessionsRoutes(service, async () => [
      { id: 'codex', name: 'Codex', command: 'codex' },
    ]).request(route, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, query: calls[0] as Record<string, unknown> }
  }

  it('carries the model into the roster fold', async () => {
    const { status, query } = await seenBy('/roster', { query: { model: 'claude-opus-5' } })

    expect(status).toBe(200)
    expect(query?.model).toBe('claude-opus-5')
  })

  it('carries the same model into the statistics fold', async () => {
    const { query } = await seenBy('/stats', { days: 30, model: 'claude-opus-5' })

    expect(query?.model).toBe('claude-opus-5')
  })

  it('rejects a model that is not a name-sized string rather than truncating it', async () => {
    const { status } = await seenBy('/roster', { query: { model: 'm'.repeat(201) } })

    expect(status).toBe(400)
  })
})
