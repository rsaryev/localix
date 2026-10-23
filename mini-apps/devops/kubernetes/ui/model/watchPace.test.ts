import { describe, expect, test } from 'bun:test'
import type { KubePod } from '../../backend/contracts'
import {
  FAST_POLL_MS,
  SLOW_POLL_MS,
  applyPodWatch,
  podInFlux,
  podTabWorkItemId,
  podsEqual,
  pollIntervalFor,
  resourceTabWorkItemId,
} from './watchPace'

function pod(p: Partial<KubePod>): KubePod {
  return {
    uid: 'uid-p',
    resourceVersion: '1',
    name: 'p',
    namespace: 'default',
    phase: 'Running',
    ready: '1/1',
    readyCount: 1,
    totalCount: 1,
    restarts: 0,
    node: 'n',
    podIP: '10.0.0.1',
    createdAt: new Date().toISOString(),
    containers: ['c'],
    initContainers: [],
    containerPorts: [],
    reason: '',
    requestedCpuNanos: 0,
    requestedMemoryBytes: 0,
    ...p,
  }
}

describe('podInFlux', () => {
  test('healthy running pod is settled', () => {
    expect(podInFlux(pod({}))).toBe(false)
  })
  test('pending pod is in flux', () => {
    expect(podInFlux(pod({ phase: 'Pending' }))).toBe(true)
  })
  test('transitional/backoff reasons are in flux', () => {
    for (const reason of [
      'ContainerCreating',
      'CrashLoopBackOff',
      'Terminating',
      'ImagePullBackOff',
      'PodInitializing',
    ]) {
      expect(podInFlux(pod({ reason }))).toBe(true)
    }
  })
  test('running-but-not-all-ready is in flux', () => {
    expect(podInFlux(pod({ readyCount: 1, totalCount: 2 }))).toBe(true)
  })
  test('succeeded (completed job) is settled', () => {
    expect(podInFlux(pod({ phase: 'Succeeded', readyCount: 0, totalCount: 1 }))).toBe(false)
  })
})

describe('pollIntervalFor', () => {
  test('fast while any pod is in flux, slow once all settled', () => {
    expect(pollIntervalFor([pod({}), pod({ phase: 'Pending' })])).toBe(FAST_POLL_MS)
    expect(pollIntervalFor([pod({}), pod({})])).toBe(SLOW_POLL_MS)
    expect(pollIntervalFor([])).toBe(SLOW_POLL_MS)
  })
})

describe('applyPodWatch', () => {
  test('ADDED appends an unseen pod', () => {
    const next = applyPodWatch(
      [pod({ uid: 'uid-a', name: 'a' })],
      'ADDED',
      pod({ uid: 'uid-b', name: 'b' }),
    )
    expect(next.map((p) => p.name)).toEqual(['a', 'b'])
  })

  test('ADDED/MODIFIED replaces an existing pod in place (by uid)', () => {
    const start = [
      pod({ uid: 'uid-a', name: 'a', phase: 'Pending', resourceVersion: '1' }),
      pod({ uid: 'uid-b', name: 'b' }),
    ]
    const next = applyPodWatch(
      start,
      'MODIFIED',
      pod({ uid: 'uid-a', name: 'a', phase: 'Running', resourceVersion: '2' }),
    )
    expect(next.map((p) => p.name)).toEqual(['a', 'b']) // order preserved
    expect(next[0]?.phase).toBe('Running')
  })

  test('MODIFIED for an unseen pod is treated as an add', () => {
    const next = applyPodWatch([], 'MODIFIED', pod({ name: 'x' }))
    expect(next.map((p) => p.name)).toEqual(['x'])
  })

  test('keeps same-name pods from different namespaces independent', () => {
    const start = [
      pod({ uid: 'uid-a', namespace: 'team-a', name: 'api', resourceVersion: '1' }),
      pod({ uid: 'uid-b', namespace: 'team-b', name: 'api', resourceVersion: '1' }),
    ]
    const next = applyPodWatch(
      start,
      'MODIFIED',
      pod({
        uid: 'uid-b',
        namespace: 'team-b',
        name: 'api',
        phase: 'Pending',
        resourceVersion: '2',
      }),
    )
    expect(next).toHaveLength(2)
    expect(next[0]?.namespace).toBe('team-a')
    expect(next[1]?.phase).toBe('Pending')
    expect(
      applyPodWatch(
        next,
        'DELETED',
        pod({ uid: 'uid-a', namespace: 'team-a', name: 'api', resourceVersion: '2' }),
      ).map((candidate) => candidate.namespace),
    ).toEqual(['team-b'])
  })

  test('ignores a stale watch revision and preserves the array reference', () => {
    const start = [pod({ uid: 'uid-a', resourceVersion: '12', phase: 'Running' })]
    expect(
      applyPodWatch(
        start,
        'MODIFIED',
        pod({ uid: 'uid-a', resourceVersion: '11', phase: 'Pending' }),
      ),
    ).toBe(start)
  })

  test('DELETED removes by uid; unknown uid returns the same array reference', () => {
    const start = [pod({ uid: 'uid-a', name: 'a' }), pod({ uid: 'uid-b', name: 'b' })]
    expect(
      applyPodWatch(start, 'DELETED', pod({ uid: 'uid-a', name: 'a' })).map((p) => p.name),
    ).toEqual(['b'])
    expect(applyPodWatch(start, 'DELETED', pod({ uid: 'uid-z', name: 'zzz' }))).toBe(start)
  })
})

describe('podsEqual', () => {
  const at = new Date().toISOString()

  test('identical content compares equal across distinct arrays/objects', () => {
    expect(podsEqual([], [])).toBe(true)
    expect(podsEqual([pod({ createdAt: at })], [pod({ createdAt: at })])).toBe(true)
  })

  test('detects a changed field, a length change, and reordering', () => {
    expect(podsEqual([pod({ createdAt: at })], [pod({ createdAt: at, restarts: 1 })])).toBe(false)
    expect(podsEqual([pod({ createdAt: at })], [])).toBe(false)
    expect(
      podsEqual(
        [pod({ name: 'a', createdAt: at }), pod({ name: 'b', createdAt: at })],
        [pod({ name: 'b', createdAt: at }), pod({ name: 'a', createdAt: at })],
      ),
    ).toBe(false)
  })

  test('compares container lists by content', () => {
    expect(
      podsEqual(
        [pod({ createdAt: at, containers: ['c', 'd'] })],
        [pod({ createdAt: at, containers: ['c', 'd'] })],
      ),
    ).toBe(true)
    expect(
      podsEqual(
        [pod({ createdAt: at, containers: ['c'] })],
        [pod({ createdAt: at, containers: ['d'] })],
      ),
    ).toBe(false)
  })

  test('detects init-container and scheduler-request changes', () => {
    expect(
      podsEqual(
        [pod({ createdAt: at, initContainers: ['migrate'] })],
        [pod({ createdAt: at, initContainers: ['setup'] })],
      ),
    ).toBe(false)
    expect(
      podsEqual(
        [pod({ createdAt: at, requestedCpuNanos: 100_000_000 })],
        [pod({ createdAt: at, requestedCpuNanos: 200_000_000 })],
      ),
    ).toBe(false)
    expect(
      podsEqual(
        [pod({ createdAt: at, requestedMemoryBytes: 128 })],
        [pod({ createdAt: at, requestedMemoryBytes: 256 })],
      ),
    ).toBe(false)
  })

  test('compares port-forward metadata structurally, including probe changes', () => {
    const httpPort = {
      container: 'service',
      name: 'http',
      port: 4000,
      protocol: 'TCP' as const,
      probe: 'readiness' as const,
    }
    expect(
      podsEqual(
        [pod({ createdAt: at, containerPorts: [httpPort] })],
        [pod({ createdAt: at, containerPorts: [{ ...httpPort }] })],
      ),
    ).toBe(true)
    expect(
      podsEqual(
        [pod({ createdAt: at, containerPorts: [httpPort] })],
        [pod({ createdAt: at, containerPorts: [{ ...httpPort, probe: null }] })],
      ),
    ).toBe(false)
  })
})

describe('podTabWorkItemId', () => {
  test('matches the grid WorkItem id formula (context/namespace/name)', () => {
    expect(podTabWorkItemId('kind', 'default', 'web-0')).toBe(
      'devops:kubernetes-pod:kind/default/web-0',
    )
    expect(podTabWorkItemId(undefined, 'default', 'web-0')).toBe(
      'devops:kubernetes-pod:/default/web-0',
    )
  })
})

describe('resourceTabWorkItemId', () => {
  test('keys the tab by kind/context/namespace/name', () => {
    expect(resourceTabWorkItemId('deployment', 'prod', 'apps', 'web')).toBe(
      'devops:kubernetes-resource:deployment/prod/apps/web',
    )
    expect(resourceTabWorkItemId('service', undefined, 'apps', 'api')).toBe(
      'devops:kubernetes-resource:service//apps/api',
    )
  })
})
