import { describe, it, expect } from 'bun:test'
import {
  createSearchProviderRegistry,
  selectProviders,
  type SearchHit,
  type SearchProvider,
} from './search-provider'

const hit = (id: string, score = 0.5): SearchHit => ({ id, domain: 'x', title: id, score })
const mk = (
  id: string,
  tier: 'eager' | 'lazy',
  hits: SearchHit[],
  opts: { throws?: boolean } = {},
): SearchProvider => ({
  id,
  title: id,
  tier,
  search: async () => {
    if (opts.throws) throw new Error('boom')
    return hits
  },
})

describe('selectProviders', () => {
  const ps = [mk('a', 'eager', []), mk('b', 'lazy', []), mk('c', 'eager', [])]
  it('no domains → eager only, in registration order', () =>
    expect(selectProviders(ps, undefined).map((p) => p.id)).toEqual(['a', 'c']))
  it('empty domains → eager only', () =>
    expect(selectProviders(ps, []).map((p) => p.id)).toEqual(['a', 'c']))
  it('named domains → exactly those (incl. lazy)', () =>
    expect(selectProviders(ps, ['b']).map((p) => p.id)).toEqual(['b']))
  it('preserves registration order regardless of domains order', () =>
    expect(selectProviders(ps, ['c', 'a']).map((p) => p.id)).toEqual(['a', 'c']))
})

describe('registry.searchAll', () => {
  it('stamps domain from the producing provider', async () => {
    const r = createSearchProviderRegistry()
    r.register(mk('sessions', 'eager', [hit('localix://resource/chat/session/1')]))
    const out = await r.searchAll('u', { text: 'x' })
    expect(out.hits).toHaveLength(1)
    expect(out.hits[0]!.domain).toBe('sessions')
    expect(out.problems).toEqual([])
  })
  // Was: "swallows a throwing provider to []". It still cannot fail the query — but a
  // silent [] is what made a dead backend look like "no matches", so the throw now
  // ALSO produces a problem addressed to the domain that threw.
  it('keeps the other providers running and reports the one that threw', async () => {
    const r = createSearchProviderRegistry()
    r.register(mk('ok', 'eager', [hit('1')]))
    r.register(mk('bad', 'eager', [], { throws: true }))
    const out = await r.searchAll('u', { text: 'x' })
    expect(out.hits.map((h) => h.domain)).toEqual(['ok'])
    expect(out.problems).toEqual([
      { message: 'bad could not be searched', detail: 'boom', field: 'bad' },
    ])
  })
  it('carries a provider-declared problem beside its partial hits', async () => {
    const r = createSearchProviderRegistry()
    r.register({
      id: 'docker',
      title: 'Docker',
      tier: 'eager',
      search: async () => ({
        hits: [hit('c1')],
        problem: { message: 'Images could not be listed' },
      }),
    })
    const out = await r.searchAll('u', { text: 'x' })
    expect(out.hits).toHaveLength(1)
    // `field` is stamped by the registry so the row is addressable to a domain.
    expect(out.problems).toEqual([{ message: 'Images could not be listed', field: 'docker' }])
  })
  it('runs a lazy provider only when explicitly scoped', async () => {
    const r = createSearchProviderRegistry()
    r.register(mk('eagerD', 'eager', [hit('e')]))
    r.register(mk('lazyD', 'lazy', [hit('l')]))
    expect((await r.searchAll('u', { text: 'x' })).hits.map((h) => h.domain)).toEqual(['eagerD'])
    expect(
      (await r.searchAll('u', { text: 'x', domains: ['lazyD'] })).hits.map((h) => h.domain),
    ).toEqual(['lazyD'])
  })
  it('caps per provider with limitPerProvider', async () => {
    const r = createSearchProviderRegistry()
    r.register(mk('big', 'eager', [hit('1'), hit('2'), hit('3')]))
    expect((await r.searchAll('u', { text: 'x', limitPerProvider: 2 })).hits).toHaveLength(2)
  })
})
