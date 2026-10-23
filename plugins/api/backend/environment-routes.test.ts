import { expect, test } from 'bun:test'
import { createRestRoutes } from './routes'
import { createMemoryCollection } from './collection/testing/memory'
import type { EnvironmentService } from './environments/service'
import { RestError } from './errors'

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

const savingWith = (failure: Error) => {
  const environments = {
    get: async () => null,
    save: async () => {
      throw failure
    },
  } as unknown as EnvironmentService
  return createRestRoutes({
    collection: () => createMemoryCollection(),
    environments,
    resolveSecret: async () => null,
    send: { timeoutMs: 1000, maxBodyBytes: 1000, allowPrivateNetwork: false },
  })
}

const create = (app: ReturnType<typeof createRestRoutes>) =>
  app.request(
    '/environments',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Staging', variables: [] }),
    },
    { userId: 'u', projectId: 'p', cwd: '/fixture' },
  )

test('a vault failure is told by its type, not by the word "vault" in a message', async () => {
  const locked = await create(
    savingWith(new RestError('secret_unavailable', 'The native vault is locked.')),
  )
  expect(locked.status).toBe(503)
  expect((await locked.json()).code).toBe('secret_unavailable')

  // A plain error that merely mentions a vault is the request's problem, not the vault's.
  const named = await create(savingWith(new Error('"vault-prod" is not a usable name.')))
  expect(named.status).toBe(400)
  expect((await named.json()).code).toBe('bad_request')
})
