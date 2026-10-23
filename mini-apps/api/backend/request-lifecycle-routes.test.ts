import { afterEach, expect, test } from 'bun:test'
import { createRestRoutes } from './routes'
import { createMemoryCollection } from './collection/testing/memory'
import { listHistory, recordSend, resetHistory } from './history'
import type { SendResponse } from './contracts'

afterEach(resetHistory)

const response: SendResponse = {
  status: 200,
  statusText: 'OK',
  url: 'https://api.test',
  headers: {},
  body: '',
  bytes: 0,
  truncated: false,
  elapsedMs: 1,
  hops: [],
}

test.each([
  ['successful', false],
  ['refused', true],
] as const)(
  'rename updates session history only after a successful move (%s)',
  async (_case, refused) => {
    const store = createMemoryCollection([
      {
        name: 'Old',
        spec: {
          url: 'https://api.test',
          method: 'GET',
          headers: [],
          query: [],
          auth: { type: 'none' },
        },
      },
    ])
    recordSend('u', 'Old', response, 'user', undefined, 'current')
    recordSend('u', 'Old', response, 'agent', undefined, 'other')
    recordSend('other-user', 'Old', response, 'user', undefined, 'current')
    const entry = listHistory('u', 'Old', 'current')[0]!
    const app = createRestRoutes({
      collection: () => ({
        ...store,
        rename: async (from, to) =>
          refused ? { ok: false, problem: 'fixture move refused' } : store.rename(from, to),
      }),
      resolveSecret: async () => null,
      send: { timeoutMs: 1000, maxBodyBytes: 1000, allowPrivateNetwork: false },
    })
    const res = await app.request(
      '/requests/Old/rename',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ to: 'New' }),
      },
      { userId: 'u', projectId: 'p', cwd: '/fixture', sessionId: 'current' },
    )
    expect(res.status).toBe(refused ? 422 : 200)
    expect(listHistory('u', refused ? 'Old' : 'New', 'current')[0]).toBe(entry)
    expect(listHistory('u', refused ? 'New' : 'Old', 'current')).toEqual([])
    expect(listHistory('u', 'Old', 'other')).toHaveLength(1)
    expect(listHistory('other-user', 'Old', 'current')).toHaveLength(1)
    expect(await store.get(refused ? 'Old' : 'New')).not.toBeNull()
  },
)
