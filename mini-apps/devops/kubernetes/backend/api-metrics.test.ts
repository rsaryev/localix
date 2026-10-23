import { afterEach, describe, expect, test } from 'bun:test'
import { METRICS_TTL_MS, fetchNodeMetrics, fetchPodMetrics, invalidateMetrics } from './api-metrics'
import { ALL_NAMESPACES } from './contracts'

afterEach(() => invalidateMetrics())

const podBody = (cpu: string) => ({
  items: [
    {
      metadata: { name: 'api', namespace: 'default' },
      containers: [{ name: 'app', usage: { cpu, memory: '1Ki' } }],
    },
  ],
})

/** A fetcher that records every path it was asked for, so cache hits are observable. */
function recorder(handler: (path: string) => unknown) {
  const paths: string[] = []
  return {
    paths,
    fetchJson: async (path: string) => {
      paths.push(path)
      const result = handler(path)
      if (result instanceof Error) throw result
      return result
    },
  }
}

describe('fetchPodMetrics', () => {
  test('all-namespaces and one namespace hit different metrics paths', async () => {
    const { paths, fetchJson } = recorder(() => podBody('1n'))
    await fetchPodMetrics('ctx', ALL_NAMESPACES, fetchJson)
    await fetchPodMetrics('ctx', 'kube system', fetchJson)
    expect(paths).toEqual([
      '/apis/metrics.k8s.io/v1beta1/pods',
      '/apis/metrics.k8s.io/v1beta1/namespaces/kube%20system/pods',
    ])
  })

  test('an empty namespace means all namespaces, matching the list endpoints', async () => {
    const { paths, fetchJson } = recorder(() => podBody('1n'))
    await fetchPodMetrics('ctx', '', fetchJson)
    expect(paths).toEqual(['/apis/metrics.k8s.io/v1beta1/pods'])
  })

  test('a missing metrics-server is null usage, NOT a rejection', async () => {
    // The whole point: a cluster without the add-on must still render its pod list.
    const { fetchJson } = recorder(() => new Error('404 /apis/metrics.k8s.io/v1beta1/pods'))
    expect(await fetchPodMetrics('ctx', 'default', fetchJson)).toEqual({ pods: null })
  })

  test('a forbidden metrics API is also null usage', async () => {
    const { fetchJson } = recorder(() => new Error('403 forbidden'))
    expect((await fetchPodMetrics('ctx', 'default', fetchJson)).pods).toBeNull()
  })

  test('concurrent callers on the same tick share ONE request', async () => {
    const { paths, fetchJson } = recorder(() => podBody('5n'))
    const results = await Promise.all([
      fetchPodMetrics('ctx', 'default', fetchJson),
      fetchPodMetrics('ctx', 'default', fetchJson),
      fetchPodMetrics('ctx', 'default', fetchJson),
    ])
    expect(paths).toHaveLength(1)
    expect(results.map((r) => r.pods?.[0]?.cpuNanos)).toEqual([5, 5, 5])
  })

  test('the cache expires, and different contexts never share an entry', async () => {
    let cpu = '1n'
    const { paths, fetchJson } = recorder(() => podBody(cpu))
    let now = 1_000
    const clock = () => now

    expect((await fetchPodMetrics('a', 'default', fetchJson, clock)).pods?.[0]?.cpuNanos).toBe(1)
    cpu = '2n'
    // Same context, still inside the TTL — the stale value is intentional.
    expect((await fetchPodMetrics('a', 'default', fetchJson, clock)).pods?.[0]?.cpuNanos).toBe(1)
    // A second context must not read the first cluster's numbers.
    expect((await fetchPodMetrics('b', 'default', fetchJson, clock)).pods?.[0]?.cpuNanos).toBe(2)
    now += METRICS_TTL_MS
    cpu = '3n'
    expect((await fetchPodMetrics('a', 'default', fetchJson, clock)).pods?.[0]?.cpuNanos).toBe(3)
    expect(paths).toHaveLength(3)
  })

  test('a failed fetch is evicted, so the next caller retries instead of inheriting it', async () => {
    let fail = true
    const { paths, fetchJson } = recorder(() => (fail ? new Error('503') : podBody('7n')))
    expect((await fetchPodMetrics('ctx', 'default', fetchJson)).pods).toBeNull()
    fail = false
    expect((await fetchPodMetrics('ctx', 'default', fetchJson)).pods?.[0]?.cpuNanos).toBe(7)
    expect(paths).toHaveLength(2)
  })

  test('invalidateMetrics drops one context without disturbing the others', async () => {
    let cpu = '1n'
    const { fetchJson } = recorder(() => podBody(cpu))
    await fetchPodMetrics('a', 'default', fetchJson)
    await fetchPodMetrics('b', 'default', fetchJson)
    cpu = '9n'
    invalidateMetrics('a')
    expect((await fetchPodMetrics('a', 'default', fetchJson)).pods?.[0]?.cpuNanos).toBe(9)
    expect((await fetchPodMetrics('b', 'default', fetchJson)).pods?.[0]?.cpuNanos).toBe(1)
  })
})

describe('fetchNodeMetrics', () => {
  test('reads the node metrics path and shapes its rows', async () => {
    const { paths, fetchJson } = recorder(() => ({
      items: [{ metadata: { name: 'node-a' }, usage: { cpu: '250m', memory: '1Gi' } }],
    }))
    const result = await fetchNodeMetrics('ctx', fetchJson)
    expect(paths).toEqual(['/apis/metrics.k8s.io/v1beta1/nodes'])
    expect(result.nodes).toEqual([
      { name: 'node-a', cpuNanos: 250_000_000, memoryBytes: 1024 ** 3 },
    ])
  })

  test('no metrics API is null usage', async () => {
    const { fetchJson } = recorder(() => new Error('404'))
    expect((await fetchNodeMetrics('ctx', fetchJson)).nodes).toBeNull()
  })

  test('pod and node usage do not collide in the cache', async () => {
    const { paths, fetchJson } = recorder((path) =>
      path.endsWith('/nodes')
        ? { items: [{ metadata: { name: 'n' }, usage: { cpu: '1n', memory: '0' } }] }
        : podBody('1n'),
    )
    await fetchPodMetrics('ctx', ALL_NAMESPACES, fetchJson)
    const nodes = await fetchNodeMetrics('ctx', fetchJson)
    expect(nodes.nodes).toHaveLength(1)
    expect(paths).toHaveLength(2)
  })
})
