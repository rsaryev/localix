import { describe, expect, test } from 'bun:test'

import { createReaderRoutes } from './routes'
import { ReaderStatsService } from './stats'

describe('reader library management routes', () => {
  test('wires collection creation, metadata patches, and membership changes', async () => {
    const calls: Array<{ method: string; value: unknown }> = []
    const service = {
      async createCollection(name: string) {
        calls.push({ method: 'createCollection', value: name })
        return {
          id: 'research',
          name,
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        }
      },
      async updateMetadata(_root: string, source: unknown, patch: unknown) {
        calls.push({ method: 'updateMetadata', value: { source, patch } })
        return { path: '/book.md', title: 'Edited', format: 'md', size: 1, updatedAt: '' }
      },
      async changeCollections(_root: string, sources: unknown, add: unknown, remove: unknown) {
        calls.push({ method: 'changeCollections', value: { sources, add, remove } })
        return []
      },
    }
    const app = createReaderRoutes(service as never)

    const collectionResponse = await app.request('/library/collections', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Research' }),
    })
    expect(collectionResponse.status).toBe(201)

    const metadataResponse = await app.request(
      '/library/book?path=%2Fbook.md',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Edited', author: null }),
      },
      { cwd: '/tmp' } as never,
    )
    expect(metadataResponse.status).toBe(200)

    const membershipResponse = await app.request(
      '/library/bulk',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'changeCollections',
          sources: [{ path: '/book.md' }],
          addCollectionIds: ['research'],
          removeCollectionIds: [],
        }),
      },
      { cwd: '/tmp' } as never,
    )
    expect(membershipResponse.status).toBe(200)
    expect(calls).toEqual([
      { method: 'createCollection', value: 'Research' },
      {
        method: 'updateMetadata',
        value: { source: { path: '/book.md' }, patch: { title: 'Edited', author: null } },
      },
      {
        method: 'changeCollections',
        value: { sources: [{ path: '/book.md' }], add: ['research'], remove: [] },
      },
    ])
  })

  test('rejects empty bulk selections before invoking the service', async () => {
    const app = createReaderRoutes({} as never)
    const response = await app.request('/library/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'remove', sources: [] }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'sources: Too small: expected array to have >=1 items',
    })
  })
})

describe('reader statistics routes', () => {
  test('records only against the canonical explicit library identity', async () => {
    const calls: unknown[] = []
    const service = {
      async librarySource(_root: string, source: unknown) {
        calls.push(source)
        return { path: '/canonical/book.md' }
      },
    }
    const stats = new ReaderStatsService()
    const app = createReaderRoutes(service as never, stats)
    const response = await app.request(
      '/stats/events',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: 'event-1',
          source: { path: './book.md' },
          sessionId: 'session-1',
          startedAt: '2026-08-01T10:00:00.000Z',
          endedAt: '2026-08-01T10:00:10.000Z',
          chapter: 0,
          position: 1,
          totalPositions: 2,
          progress: 25,
          timezoneOffset: -180,
        }),
      },
      { cwd: '/workspace' } as never,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ recorded: true })
    expect(calls).toEqual([{ path: './book.md' }])
    expect((await stats.get({ path: '/canonical/book.md' })).book.readMs).toBe(10_000)
  })
})
