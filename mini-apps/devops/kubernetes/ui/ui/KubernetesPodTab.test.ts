import { describe, expect, test } from 'bun:test'

import type { KubePod } from '../../backend/contracts'
import { podSnapshotMatches } from '../model/usePodTabSeed'

const pod: KubePod = {
  uid: 'pod-uid',
  resourceVersion: '17',
  name: 'api-7c8d',
  namespace: 'production',
  phase: 'Running',
  ready: '1/1',
  readyCount: 1,
  totalCount: 1,
  restarts: 0,
  node: 'worker-1',
  podIP: '10.0.0.4',
  createdAt: '2026-07-24T00:00:00.000Z',
  containers: ['api'],
  initContainers: [],
  containerPorts: [
    { container: 'api', name: 'http', port: 8080, protocol: 'TCP', probe: 'readiness' },
  ],
  reason: '',
  requestedCpuNanos: 0,
  requestedMemoryBytes: 0,
}

describe('Kubernetes pod detail seed', () => {
  test('reuses only an exact name and namespace snapshot', () => {
    expect(podSnapshotMatches(pod, 'api-7c8d', 'production')).toBe(true)
    expect(podSnapshotMatches(pod, 'api-7c8d', 'staging')).toBe(false)
    expect(podSnapshotMatches(pod, 'worker-1', 'production')).toBe(false)
    expect(podSnapshotMatches(undefined, 'api-7c8d', 'production')).toBe(false)
  })
})
