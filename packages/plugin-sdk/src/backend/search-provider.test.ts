import { describe, expect, it } from 'bun:test'
import { createSearchProviderRegistry, type SearchProvider } from './search-provider'

const provider = (id: string): SearchProvider => ({
  id,
  title: id,
  tier: 'eager',
  search: async () => [{ id: `${id}:1`, domain: id, title: 'hit', score: 1 }],
})

describe('createSearchProviderRegistry unregister', () => {
  it('removes the provider from lookups and fan-out', async () => {
    const registry = createSearchProviderRegistry()
    registry.register(provider('a'))
    registry.register(provider('b'))
    registry.unregister('a')
    expect(registry.get('a')).toBeUndefined()
    expect(registry.list().map((p) => p.id)).toEqual(['b'])
    const { hits } = await registry.searchAll('u', { text: 'q' })
    expect(hits.map((h) => h.domain)).toEqual(['b'])
  })

  it('is a no-op for unknown ids and allows re-registration', () => {
    const registry = createSearchProviderRegistry()
    registry.unregister('ghost')
    registry.register(provider('a'))
    registry.unregister('a')
    registry.register(provider('a'))
    expect(registry.get('a')).toBeDefined()
  })
})
