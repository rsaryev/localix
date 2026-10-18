import { describe, expect, test } from 'bun:test'

import type { CatalogResponse } from './contracts'
import { createCatalogRoutes } from './routes'

const catalog = (name: string): CatalogResponse => ({
  providers: [{ id: 'p', name: 'P', modelCount: 1, authType: 'api-key' }],
  models: [
    {
      id: 'p/m',
      name,
      providerId: 'p',
      providerName: 'P',
      supportsTools: true,
      supportsReasoning: false,
      supportsAttachment: false,
      inputModalities: ['text'],
      outputModalities: ['text'],
    },
  ],
  oauthProviderIds: [],
  oauthProviders: [],
})

/**
 * The catalog is ~700 KB and changes only when the adapter's metadata does, so a client that
 * already holds it must not be sent it again — and a new build must never be masked as unchanged.
 */
describe('GET /rpc/models/catalog', () => {
  test('a client holding the current build gets a 304 with no body', async () => {
    const current = catalog('M')
    const app = createCatalogRoutes({ getFullCatalog: async () => current })

    const first = await app.request('/')
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toBe('no-cache')
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    const body = (await first.json()) as CatalogResponse
    expect(body.models[0]?.name).toBe('M')

    const again = await app.request('/', { headers: { 'If-None-Match': `W/${etag}` } })
    expect(again.status).toBe(304)
    expect(await again.text()).toBe('')
  })

  test('a new build is a new tag, so a stale copy is replaced', async () => {
    let current = catalog('Before')
    const app = createCatalogRoutes({ getFullCatalog: async () => current })
    const etag = (await app.request('/')).headers.get('etag')!

    current = catalog('After')
    const next = await app.request('/', { headers: { 'If-None-Match': etag } })
    expect(next.status).toBe(200)
    expect(next.headers.get('etag')).not.toBe(etag)
    expect(((await next.json()) as CatalogResponse).models[0]?.name).toBe('After')
  })
})
