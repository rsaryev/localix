import { expect, test } from 'bun:test'
import { createRestRoutes } from './routes'
import { createMemoryCollection } from './collection/memory'
import type { EnvironmentService } from './environments/service'

test.each(['POST', 'PUT'] as const)(
  '%s environment validation rejects text/plain before reaching the service',
  async (method) => {
    const calls: string[] = []
    const environments = new Proxy(
      {},
      {
        get: (_target, operation) => {
          calls.push(String(operation))
          return async () => {
            throw new Error('Service must not be reached')
          }
        },
      },
    ) as EnvironmentService
    const app = createRestRoutes({
      collection: () => createMemoryCollection(),
      environments,
      resolveSecret: async () => null,
      send: { timeoutMs: 1000, maxBodyBytes: 1000, allowPrivateNetwork: false },
    })
    const res = await app.request(
      method === 'POST' ? '/environments' : '/environments/Staging',
      {
        method,
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify({ name: 'Staging', variables: [] }),
      },
      { userId: 'u', projectId: 'p', cwd: '/fixture' },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('bad_request')
    expect(calls).toEqual([])
  },
)
