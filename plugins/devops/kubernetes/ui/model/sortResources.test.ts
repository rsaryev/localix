import { describe, expect, test } from 'bun:test'

import type { KubeDeployment, KubeNode, KubePod } from '../../backend/contracts'
import { podsOnNode, sortKubeDeployments, sortKubeNodes, sortKubePods } from './sortResources'

describe('Kubernetes inventory sorting', () => {
  test('puts unhealthy pods before healthy pods', () => {
    const pod = (name: string, phase: KubePod['phase'], reason = ''): KubePod => ({
      uid: `uid-${name}`,
      resourceVersion: '1',
      name,
      namespace: 'apps',
      phase,
      ready: '1/1',
      readyCount: 1,
      totalCount: 1,
      restarts: 0,
      node: '',
      podIP: '',
      createdAt: '2026-07-23T10:00:00Z',
      containers: [],
      initContainers: [],
      containerPorts: [],
      reason,
      requestedCpuNanos: 0,
      requestedMemoryBytes: 0,
    })
    const rows = [pod('healthy', 'Running'), pod('broken', 'Running', 'CrashLoopBackOff')]
    expect(sortKubePods(rows, { key: 'status', direction: 'asc' }).map((row) => row.name)).toEqual([
      'broken',
      'healthy',
    ])
  })

  test('sorts deployment readiness as a ratio', () => {
    const deployment = (name: string, ready: string): KubeDeployment => ({
      name,
      namespace: 'apps',
      ready,
      upToDate: 0,
      available: 0,
      createdAt: '2026-07-23T10:00:00Z',
    })
    const rows = [deployment('ready', '3/3'), deployment('partial', '1/2')]
    expect(
      sortKubeDeployments(rows, { key: 'ready', direction: 'asc' }).map((row) => row.name),
    ).toEqual(['partial', 'ready'])
  })

  test('builds a node relation from only matching pods and searches namespace too', () => {
    const pod = (name: string, node: string, namespace: string): KubePod => ({
      uid: `uid-${namespace}-${name}`,
      resourceVersion: '1',
      name,
      namespace,
      phase: 'Running',
      ready: '1/1',
      readyCount: 1,
      totalCount: 1,
      restarts: 0,
      node,
      podIP: '',
      createdAt: '2026-07-23T10:00:00Z',
      containers: [],
      initContainers: [],
      containerPorts: [],
      reason: '',
      requestedCpuNanos: 0,
      requestedMemoryBytes: 0,
    })
    const rows = [
      pod('api-0', 'worker-a', 'apps'),
      pod('db-0', 'worker-a', 'data'),
      pod('api-1', 'worker-b', 'apps'),
    ]
    expect(podsOnNode(rows, 'worker-a', '').map((row) => row.name)).toEqual(['api-0', 'db-0'])
    expect(podsOnNode(rows, 'worker-a', 'DATA').map((row) => row.name)).toEqual(['db-0'])
  })

  test('puts non-ready nodes first for the default operational status sort', () => {
    const node = (name: string, status: KubeNode['status']): KubeNode => ({
      name,
      status,
      roles: ['worker'],
      version: 'v1.35.0',
      schedulable: true,
      createdAt: '2026-07-23T10:00:00Z',
      allocatableCpuNanos: 0,
      allocatableMemoryBytes: 0,
    })
    const rows = [node('healthy', 'Ready'), node('broken', 'NotReady')]
    expect(sortKubeNodes(rows, { key: 'status', direction: 'asc' }).map((row) => row.name)).toEqual(
      ['broken', 'healthy'],
    )
  })
})
