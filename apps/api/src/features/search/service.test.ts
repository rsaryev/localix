import { describe, it, expect } from 'bun:test'
import {
  createSearchProviderRegistry,
  type SearchHit,
  type SearchProvider,
} from '../agent-core/search/provider'
import { createSearchService, groupHits, sortHits, parseCursor, type DomainMeta } from './service'

const hit = (domain: string, title: string, score: number): SearchHit => ({
  id: `${domain}/${title}`,
  domain,
  title,
  score,
})
const provider = (id: string, tier: 'eager' | 'lazy', hits: SearchHit[]): SearchProvider => ({
  id,
  title: id.toUpperCase(),
  tier,
  search: async () => hits,
})

function svc(providers: SearchProvider[]) {
  const r = createSearchProviderRegistry()
  providers.forEach((p) => r.register(p))
  return createSearchService({ registry: r })
}

describe('sortHits', () => {
  it('sorts by score desc (stable on title)', () =>
    expect(sortHits([hit('a', 'x', 0.2), hit('a', 'y', 0.9)]).map((h) => h.title)).toEqual([
      'y',
      'x',
    ]))
})

describe('parseCursor', () => {
  it('parses / defaults to 0', () => {
    expect(parseCursor(undefined)).toBe(0)
    expect(parseCursor('10')).toBe(10)
    expect(parseCursor('-5')).toBe(0)
    expect(parseCursor('junk')).toBe(0)
  })
})

describe('groupHits', () => {
  const order: DomainMeta[] = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
  ]
  it('groups in registry order, caps to groupLimit, keeps full total, sorts within', () => {
    const hits = [
      hit('b', 'b1', 0.5),
      hit('a', 'a1', 0.5),
      hit('a', 'a2', 0.9),
      hit('a', 'a3', 0.1),
    ]
    const groups = groupHits(hits, order, 2)
    expect(groups.map((g) => g.domain)).toEqual(['a', 'b'])
    expect(groups[0]!.hits).toHaveLength(2)
    expect(groups[0]!.total).toBe(3)
    expect(groups[0]!.hits[0]!.title).toBe('a2')
  })
  it('omits empty domains', () =>
    expect(groupHits([hit('a', 'a1', 0.5)], order, 5).map((g) => g.domain)).toEqual(['a']))
})

describe('createSearchService', () => {
  it('aggregate view → per-domain groups (top-N) + flat preview', async () => {
    const s = svc([
      provider('projects', 'eager', [hit('projects', 'p', 0.9)]),
      provider('sessions', 'eager', [hit('sessions', 's', 0.8)]),
    ])
    const res = await s.search('u', { text: 'x' })
    expect(res.groups.map((g) => g.domain)).toEqual(['projects', 'sessions'])
    expect(res.total).toBe(2)
    expect(res.hits[0]!.domain).toBe('projects')
    expect(res.nextCursor).toBeUndefined()
  })

  it('scoped view → one paginated group via opaque cursor', async () => {
    const many = Array.from({ length: 5 }, (_, i) => hit('sessions', `s${i}`, 1 - i * 0.1))
    const s = svc([provider('sessions', 'eager', many)])
    const p1 = await s.search('u', { text: 'x', domains: ['sessions'], limit: 2 })
    expect(p1.hits).toHaveLength(2)
    expect(p1.groups).toHaveLength(1)
    expect(p1.nextCursor).toBe('2')
    const p2 = await s.search('u', {
      text: 'x',
      domains: ['sessions'],
      limit: 2,
      cursor: p1.nextCursor,
    })
    expect(p2.hits.map((h) => h.title)).toEqual(['s2', 's3'])
    const p3 = await s.search('u', {
      text: 'x',
      domains: ['sessions'],
      limit: 2,
      cursor: p2.nextCursor,
    })
    expect(p3.hits.map((h) => h.title)).toEqual(['s4'])
    expect(p3.nextCursor).toBeUndefined()
  })

  it('omits `problems` entirely when every domain answered', async () => {
    const s = svc([provider('sessions', 'eager', [hit('sessions', 's', 0.8)])])
    // Presence is the signal. An always-present `[]` would force every surface to
    // branch on length and would put "something failed" on the wire for a healthy search.
    expect(await s.search('u', { text: 'x' })).not.toHaveProperty('problems')
  })

  it('carries a failing domain beside the domains that answered', async () => {
    const s = svc([
      provider('sessions', 'eager', [hit('sessions', 's', 0.8)]),
      {
        id: 'docker',
        title: 'Docker',
        tier: 'eager',
        search: async () => ({ hits: [], problem: { message: 'Docker is not available' } }),
      },
    ])
    const res = await s.search('u', { text: 'x' })
    expect(res.groups.map((g) => g.domain)).toEqual(['sessions'])
    expect(res.problems).toEqual([{ message: 'Docker is not available', field: 'docker' }])
  })

  it('reports the failing domain in the scoped view too', async () => {
    const s = svc([
      {
        id: 'k8s',
        title: 'Kubernetes',
        tier: 'lazy',
        search: async () => ({
          hits: [],
          problem: { message: 'Cannot reach this cluster right now.' },
        }),
      },
    ])
    const res = await s.search('u', { text: 'x', domains: ['k8s'] })
    expect(res.groups).toEqual([])
    expect(res.problems?.[0]?.message).toBe('Cannot reach this cluster right now.')
  })

  it('lazy domain absent from aggregate, present when scoped', async () => {
    const s = svc([
      provider('sessions', 'eager', [hit('sessions', 's', 0.8)]),
      provider('docker', 'lazy', [hit('docker', 'd', 0.8)]),
    ])
    expect((await s.search('u', { text: 'x' })).groups.map((g) => g.domain)).toEqual(['sessions'])
    expect(
      (await s.search('u', { text: 'x', domains: ['docker'] })).groups.map((g) => g.domain),
    ).toEqual(['docker'])
  })
})
