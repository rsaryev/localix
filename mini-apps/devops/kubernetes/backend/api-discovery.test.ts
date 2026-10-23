import { beforeEach, describe, expect, test } from 'bun:test'
import { discoverClusterResources, getClusterResources, invalidateDiscovery } from './api-discovery'

const CORE = { resources: [{ name: 'pods', kind: 'Pod', namespaced: true, verbs: ['list'] }] }
const APIS = {
  groups: [
    { name: 'apps', preferredVersion: { groupVersion: 'apps/v1' } },
    { name: 'metrics.k8s.io', preferredVersion: { groupVersion: 'metrics.k8s.io/v1beta1' } },
  ],
}
const APPS = {
  resources: [{ name: 'deployments', kind: 'Deployment', namespaced: true, verbs: ['list'] }],
}

/** A fake cluster: records every path asked, answers from a table, throws for anything absent. */
function fakeCluster(table: Record<string, unknown>, opts: { fail?: string[] } = {}) {
  const paths: string[] = []
  let inFlight = 0
  let peak = 0
  const fetchJson = async (path: string): Promise<unknown> => {
    paths.push(path)
    inFlight++
    peak = Math.max(peak, inFlight)
    try {
      await Promise.resolve()
      if (opts.fail?.includes(path)) throw new Error(`503 ${path}`)
      if (!(path in table)) throw new Error(`404 ${path}`)
      return table[path]
    } finally {
      inFlight--
    }
  }
  return { fetchJson, paths, peak: () => peak, calls: () => paths.length }
}

const FULL: Record<string, unknown> = {
  '/api/v1': CORE,
  '/apis': APIS,
  '/apis/apps/v1': APPS,
  '/apis/metrics.k8s.io/v1beta1': {
    resources: [{ name: 'pods', kind: 'PodMetrics', verbs: ['list'] }],
  },
}

describe('discoverClusterResources', () => {
  test('asks core, the group list, and each preferred group-version', async () => {
    const cluster = fakeCluster(FULL)
    const result = await discoverClusterResources(cluster.fetchJson)
    expect(cluster.paths.sort()).toEqual([
      '/api/v1',
      '/apis',
      '/apis/apps/v1',
      '/apis/metrics.k8s.io/v1beta1',
    ])
    expect(result.unavailable).toEqual([])
    expect(result.resources.map((r) => `${r.apiVersion}/${r.kind}`).sort()).toEqual([
      'apps/v1/Deployment',
      'metrics.k8s.io/v1beta1/PodMetrics',
      'v1/Pod',
    ])
  })

  test('one group failing does not fail discovery — the rest survive and it is named', async () => {
    // The real scenario: metrics-server is down, so its aggregated group 503s.
    const cluster = fakeCluster(FULL, { fail: ['/apis/metrics.k8s.io/v1beta1'] })
    const result = await discoverClusterResources(cluster.fetchJson)
    expect(result.unavailable).toEqual(['metrics.k8s.io/v1beta1'])
    const kinds = result.resources.map((r) => r.kind)
    expect(kinds).toContain('Pod')
    expect(kinds).toContain('Deployment')
    expect(kinds).not.toContain('PodMetrics')
  })

  test('a failing core still yields the groups, and a failing /apis still yields core', async () => {
    const noCore = await discoverClusterResources(
      fakeCluster(FULL, { fail: ['/api/v1'] }).fetchJson,
    )
    expect(noCore.unavailable).toEqual(['v1'])
    expect(noCore.resources.map((r) => r.kind)).toContain('Deployment')

    const noGroups = await discoverClusterResources(
      fakeCluster(FULL, { fail: ['/apis'] }).fetchJson,
    )
    expect(noGroups.unavailable).toEqual(['/apis'])
    expect(noGroups.resources.map((r) => r.kind)).toEqual(['Pod'])
  })

  test('total failure reports both endpoints rather than "this cluster serves nothing"', async () => {
    const result = await discoverClusterResources(fakeCluster({}).fetchJson)
    expect(result.resources).toEqual([])
    expect(result.unavailable.sort()).toEqual(['/apis', 'v1'])
  })

  test('the group fan-out is bounded, not a burst', async () => {
    const groups = Array.from({ length: 30 }, (_, i) => `g${i}.example.com/v1`)
    const table: Record<string, unknown> = {
      '/api/v1': CORE,
      '/apis': { groups: groups.map((gv) => ({ preferredVersion: { groupVersion: gv } })) },
    }
    for (const gv of groups) {
      table[`/apis/${gv}`] = { resources: [{ name: 'things', kind: 'Thing', verbs: ['list'] }] }
    }
    const cluster = fakeCluster(table)
    const result = await discoverClusterResources(cluster.fetchJson)
    // All 30 answered...
    expect(result.resources.filter((r) => r.kind === 'Thing')).toHaveLength(30)
    // ...but never more than the pool limit at once (+2 for the core/apis pair fetched first).
    expect(cluster.peak()).toBeLessThanOrEqual(8)
  })
})

describe('getClusterResources', () => {
  beforeEach(() => invalidateDiscovery())

  test('concurrent callers share ONE discovery, not one each', async () => {
    const cluster = fakeCluster(FULL)
    const [a, b, c] = await Promise.all([
      getClusterResources('ctx', cluster.fetchJson),
      getClusterResources('ctx', cluster.fetchJson),
      getClusterResources('ctx', cluster.fetchJson),
    ])
    // Caching the settled result only would have run discovery three times on the same tick.
    expect(cluster.calls()).toBe(4)
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  test('a second call inside the TTL does not touch the cluster; past it, it refetches', async () => {
    const cluster = fakeCluster(FULL)
    let clock = 1_000_000
    const now = () => clock
    await getClusterResources('ctx', cluster.fetchJson, now)
    expect(cluster.calls()).toBe(4)

    clock += 299_000
    await getClusterResources('ctx', cluster.fetchJson, now)
    expect(cluster.calls()).toBe(4)

    clock += 2_000 // now past the 5-minute TTL
    await getClusterResources('ctx', cluster.fetchJson, now)
    expect(cluster.calls()).toBe(8)
  })

  test('different contexts do not share a cache entry', async () => {
    const a = fakeCluster(FULL)
    const b = fakeCluster({ '/api/v1': CORE, '/apis': { groups: [] } })
    const first = await getClusterResources('ctx-a', a.fetchJson)
    const second = await getClusterResources('ctx-b', b.fetchJson)
    // Answering ctx-b with ctx-a's CRDs would be worse than being slow.
    expect(first.resources.map((r) => r.kind)).toContain('Deployment')
    expect(second.resources.map((r) => r.kind)).toEqual(['Pod'])
  })

  test('invalidate forces a refetch; invalidate() with no key clears every context', async () => {
    const cluster = fakeCluster(FULL)
    await getClusterResources('ctx', cluster.fetchJson)
    invalidateDiscovery('ctx')
    await getClusterResources('ctx', cluster.fetchJson)
    expect(cluster.calls()).toBe(8)

    await getClusterResources('other', cluster.fetchJson)
    invalidateDiscovery()
    await Promise.all([
      getClusterResources('ctx', cluster.fetchJson),
      getClusterResources('other', cluster.fetchJson),
    ])
    expect(cluster.calls()).toBe(20)
  })

  test('an unreachable cluster resolves with everything unavailable, not a rejection', async () => {
    // Per-request failures are tolerated by design, so "cluster down" is a usable answer that names
    // what is missing — the workbench can say so instead of showing an empty picker.
    const result = await getClusterResources('ctx', async () => {
      throw new Error('ECONNREFUSED')
    })
    expect(result.unavailable.sort()).toEqual(['/apis', 'v1'])
    expect(result.resources).toEqual([])
  })

  test('a REJECTED discovery is evicted, so the next caller retries instead of inheriting it', async () => {
    // Nothing inside discovery rejects on a per-request failure, so provoke it the only way that
    // bypasses the `.catch()`: a fetch that throws before returning a promise (a programming error,
    // a bad kubeconfig turned into a synchronous throw).
    const explode = (() => {
      throw new Error('bad kubeconfig')
    }) as unknown as (path: string) => Promise<unknown>

    let thrown: unknown
    try {
      await getClusterResources('ctx', explode)
    } catch (error) {
      thrown = error
    }
    expect((thrown as Error | undefined)?.message).toBe('bad kubeconfig')

    const ok = fakeCluster(FULL)
    const recovered = await getClusterResources('ctx', ok.fetchJson)
    // A cached rejection would have re-thrown here for five minutes and asked the cluster nothing.
    expect(ok.calls()).toBe(4)
    expect(recovered.resources.map((r) => r.kind)).toContain('Deployment')
  })
})
