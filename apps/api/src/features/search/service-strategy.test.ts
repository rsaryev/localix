import { describe, expect, test } from 'bun:test'
import { createSearchProviderRegistry, type SearchQuery } from '@localixai/mini-app-sdk/backend'
import { createSearchService, type SearchStrategyPort } from './service'

function harness(strategy?: SearchStrategyPort) {
  const seen: SearchQuery[] = []
  const registry = createSearchProviderRegistry()
  registry.register({
    id: 'notes',
    title: 'Notes',
    tier: 'eager',
    search: async (_u, q) => {
      seen.push(q)
      return [{ id: 'n1', domain: 'notes', title: 'n', score: 0.5 }]
    },
  })
  return { service: createSearchService({ registry, ...(strategy ? { strategy } : {}) }), seen }
}

const semantic = { zGate: 2, similar: async () => [] }
const hybrid: SearchStrategyPort = { note: () => ({ mode: 'hybrid' }), queryFor: () => semantic }

describe('search strategy', () => {
  test('without a strategy every query is lexical and says so', async () => {
    const { service, seen } = harness()
    const res = await service.search('u', { text: 'x' })
    expect(res.strategy).toEqual({ mode: 'lexical' })
    expect(seen[0]!.semantic).toBeUndefined()
  })

  test('hybrid hands every provider the same semantic query', async () => {
    const { service, seen } = harness(hybrid)
    const res = await service.search('u', { text: 'x' })
    expect(res.strategy).toEqual({ mode: 'hybrid' })
    expect(seen[0]!.semantic).toBe(semantic)
  })

  test('a request can force words only', async () => {
    const { service, seen } = harness(hybrid)
    const res = await service.search('u', { text: 'x', strategy: 'lexical' })
    expect(res.strategy.mode).toBe('lexical')
    expect(seen[0]!.semantic).toBeUndefined()
  })

  test('an engine that cannot answer degrades to lexical with a reason', async () => {
    const { service } = harness({ note: () => ({ mode: 'hybrid' }), queryFor: () => null })
    expect((await service.search('u', { text: 'x' })).strategy).toEqual({
      mode: 'lexical',
      reason: 'unavailable',
    })
  })

  test('a query whose meaning was not ready in time reports words only, starting', async () => {
    const missed = { zGate: 2, missed: true, similar: async () => [] }
    const { service } = harness({ note: () => ({ mode: 'hybrid' }), queryFor: () => missed })
    expect((await service.search('u', { text: 'x' })).strategy).toEqual({
      mode: 'lexical',
      reason: 'starting',
    })
  })

  test('allProjects lifts the project filter; omission scopes to unprojected chats', async () => {
    const { service, seen } = harness()
    await service.search('u', { text: 'x', projectId: 'p1', allProjects: true })
    await service.search('u', { text: 'x' })
    expect(seen[0]!.projectId).toBeUndefined()
    expect(seen[1]!.projectId).toBeNull()
  })
})
