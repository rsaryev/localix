import { describe, expect, test } from 'bun:test'
import type { KubePod } from '../../backend/contracts'
import { filterPods, groupPods, podHealth } from './groupPods'

function pod(over: Partial<KubePod>): KubePod {
  return {
    uid: 'uid-p',
    resourceVersion: '1',
    name: 'p',
    namespace: 'apps',
    phase: 'Running',
    ready: '1/1',
    readyCount: 1,
    totalCount: 1,
    restarts: 0,
    node: 'n',
    podIP: '',
    createdAt: '',
    containers: ['c'],
    initContainers: [],
    containerPorts: [],
    reason: '',
    requestedCpuNanos: 0,
    requestedMemoryBytes: 0,
    ...over,
  }
}

describe('podHealth', () => {
  test('running + all ready → healthy', () => {
    expect(podHealth(pod({}))).toBe('healthy')
  })
  test('crashloop reason on a running pod → failed', () => {
    expect(podHealth(pod({ phase: 'Running', reason: 'CrashLoopBackOff' }))).toBe('failed')
  })
  test('running but not all ready → pending', () => {
    expect(podHealth(pod({ phase: 'Running', readyCount: 1, totalCount: 2 }))).toBe('pending')
  })
  test('failed phase → failed; succeeded → succeeded; pending → pending', () => {
    expect(podHealth(pod({ phase: 'Failed' }))).toBe('failed')
    expect(podHealth(pod({ phase: 'Succeeded' }))).toBe('succeeded')
    expect(podHealth(pod({ phase: 'Pending' }))).toBe('pending')
  })
})

describe('groupPods', () => {
  test('orders failures first, then pending, running, completed', () => {
    const groups = groupPods([
      pod({ name: 'ok' }),
      pod({ name: 'bad', reason: 'CrashLoopBackOff' }),
      pod({ name: 'wait', phase: 'Pending' }),
      pod({ name: 'done', phase: 'Succeeded' }),
    ])
    expect(groups.map((g) => g.key)).toEqual(['failed', 'pending', 'healthy', 'succeeded'])
  })
})

describe('filterPods', () => {
  test('case-insensitive name substring', () => {
    const pods = [pod({ name: 'api-1' }), pod({ name: 'web-2' })]
    expect(filterPods(pods, 'API').map((p) => p.name)).toEqual(['api-1'])
    expect(filterPods(pods, '')).toHaveLength(2)
  })
})
