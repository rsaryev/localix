import { describe, expect, test } from 'bun:test'
import type { KubeDeployment, KubeNode, KubePod } from '../../backend/contracts'
import { clusterPulse, deploymentIsReady } from './clusterPulse'

const pod = (name: string, ready: number, total = 1, reason = '') =>
  ({
    uid: `uid-${name}`,
    resourceVersion: '1',
    name,
    namespace: 'default',
    phase: 'Running',
    ready: `${ready}/${total}`,
    readyCount: ready,
    totalCount: total,
    restarts: 0,
    node: '',
    podIP: '',
    createdAt: '',
    containers: [],
    initContainers: [],
    containerPorts: [],
    reason,
    requestedCpuNanos: 0,
    requestedMemoryBytes: 0,
  }) satisfies KubePod

describe('clusterPulse', () => {
  test('summarises pod faults, ready deployments, and ready nodes', () => {
    const deployments = [
      { name: 'api', ready: '2/2' },
      { name: 'web', ready: '1/2' },
    ] as KubeDeployment[]
    const nodes = [
      { name: 'a', status: 'Ready' },
      { name: 'b', status: 'NotReady' },
    ] as KubeNode[]

    expect(
      clusterPulse(
        [pod('ok', 1), pod('warming', 0), pod('crash', 1, 1, 'CrashLoopBackOff')],
        deployments,
        nodes,
      ),
    ).toEqual({
      pods: { ready: 1, total: 3, faults: 2 },
      deployments: { ready: 1, total: 2 },
      nodes: { ready: 1, total: 2 },
    })
  })

  test('accepts only a complete numeric ready/desired pair', () => {
    expect(deploymentIsReady('2/2')).toBe(true)
    expect(deploymentIsReady(' 0 / 0 ')).toBe(true)
    expect(deploymentIsReady('1/2')).toBe(false)
    expect(deploymentIsReady('/')).toBe(false)
    expect(deploymentIsReady('ready')).toBe(false)
  })
})
