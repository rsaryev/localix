import { expect, test } from 'bun:test'
import { createAgentSessionsRoutes } from './routes'
import type { AgentSessionsService } from './service'

test('uninstalled providers never fall through an empty filter to all history', async () => {
  const calls: unknown[] = []
  const service = {
    roster: async (query: unknown) => {
      calls.push(query)
      return { items: [], total: 0, withheld: 0 }
    },
    stats: async (query: unknown) => {
      calls.push(query)
      return { sessions: 99 }
    },
    transcript: async (key: string) => {
      calls.push(key)
      return null
    },
  } as unknown as AgentSessionsService
  const app = createAgentSessionsRoutes(service, async () => [
    { id: 'codex', name: 'Codex', command: 'codex' },
  ])
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  expect(
    await (await post('/roster', { query: { providers: ['claude-code'] } })).json(),
  ).toMatchObject({ items: [], total: 0 })
  expect(
    await (await post('/stats', { providers: ['claude-code'], days: 7 })).json(),
  ).toMatchObject({ sessions: 0 })
  expect((await post('/items', { key: 'claude-code:session' })).status).toBe(404)
  expect(calls).toEqual([])
  await post('/roster', { query: {} })
  expect(calls).toEqual([{ providers: ['codex'] }])
})

test('an empty machine exposes no providers and does not scan history', async () => {
  const app = createAgentSessionsRoutes(undefined, async () => [])
  expect(await (await app.request('/providers')).json()).toEqual({ providers: [] })
  expect((await app.request('/provider-status')).status).toBe(404)
})
