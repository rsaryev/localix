import { describe, expect, test } from 'bun:test'
import type { DockerContainer, DockerImage } from '../../docker/backend/contracts'
import type { KubeDeployment, KubeNode, KubePod } from '../../kubernetes/backend/contracts'
import { devOpsOverviewSnapshot } from './devopsOverview'

const container = (name: string, state: DockerContainer['state'], project?: string) =>
  ({
    id: name,
    name,
    image: 'app:latest',
    state,
    status: state,
    ports: '',
    createdAt: '',
    project,
  }) satisfies DockerContainer

const image = {
  id: 'sha256:app',
  repository: 'app',
  tag: 'latest',
  size: '1MB',
  createdAt: '',
} satisfies DockerImage

const pod = (ready: boolean) =>
  ({
    uid: ready ? 'ready' : 'pending',
    resourceVersion: '1',
    name: ready ? 'ready' : 'pending',
    namespace: 'default',
    phase: ready ? 'Running' : 'Pending',
    ready: ready ? '1/1' : '0/1',
    readyCount: ready ? 1 : 0,
    totalCount: 1,
    restarts: 0,
    node: '',
    podIP: '',
    createdAt: '',
    containers: [],
    initContainers: [],
    containerPorts: [],
    reason: '',
    requestedCpuNanos: 0,
    requestedMemoryBytes: 0,
  }) satisfies KubePod

const deployment = (ready: string) =>
  ({
    name: ready,
    namespace: 'default',
    ready,
    upToDate: 1,
    available: 1,
    createdAt: '',
  }) satisfies KubeDeployment

const node = (status: KubeNode['status']) =>
  ({
    name: status,
    status,
    roles: [],
    version: '',
    schedulable: true,
    createdAt: '',
    allocatableCpuNanos: 0,
    allocatableMemoryBytes: 0,
  }) satisfies KubeNode

function sources() {
  return {
    docker: {
      containers: [container('api', 'running', 'stack'), container('worker', 'exited', 'stack')],
      images: [image],
      unavailable: false,
      error: null,
      resourceErrors: {},
    },
    kubernetes: {
      pods: [pod(true), pod(false)],
      deployments: [deployment('1/1'), deployment('0/1')],
      nodes: [node('Ready'), node('NotReady')],
      unavailable: false,
      unreachable: false,
      error: null,
      resourceErrors: {},
    },
  }
}

describe('DevOps overview snapshot', () => {
  test('derives provider metrics and actionable health issues from one snapshot', () => {
    const { docker, kubernetes } = sources()
    const snapshot = devOpsOverviewSnapshot(docker, kubernetes)

    expect(snapshot.docker).toEqual({
      running: 1,
      containers: 2,
      images: 1,
      projects: 1,
    })
    expect(snapshot.kubernetes).toEqual({
      pods: { ready: 1, total: 2, faults: 1 },
      deployments: { ready: 1, total: 2 },
      nodes: { ready: 1, total: 2 },
    })
    expect(snapshot.issues.map((issue) => issue.key)).toEqual([
      'unhealthy-pods',
      'unready-deployments',
      'unready-nodes',
    ])
  })

  test('shows refresh failures without repeating stale collection health', () => {
    const { docker, kubernetes } = sources()
    kubernetes.resourceErrors = {
      pods: { message: 'pods timed out' },
      deployments: { message: 'deployments timed out' },
      nodes: { message: 'nodes timed out' },
    }

    const snapshot = devOpsOverviewSnapshot(docker, kubernetes)

    expect(snapshot.issues.map((issue) => issue.key)).toEqual([
      'kube-pods-error',
      'kube-deployments-error',
      'kube-nodes-error',
    ])
  })

  test('collapses provider-wide failures instead of adding downstream noise', () => {
    const { docker, kubernetes } = sources()
    docker.unavailable = true
    docker.resourceErrors = { containers: 'socket unavailable' }
    kubernetes.unreachable = true
    kubernetes.resourceErrors = { pods: { message: 'request failed' } }

    expect(devOpsOverviewSnapshot(docker, kubernetes).issues.map((issue) => issue.key)).toEqual([
      'docker-unavailable',
      'kube-unreachable',
    ])
  })
})
