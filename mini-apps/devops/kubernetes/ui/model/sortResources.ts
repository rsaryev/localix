import type {
  KubeDeployment,
  KubeNode,
  KubePod,
  KubeService,
  PortForward,
} from '../../backend/contracts'
import {
  sortableTimestamp,
  sortResources,
  type ResourceSortValue,
} from '../../../ui/model/resourceSort'
import { podHealth } from './groupPods'
import type { K8sSortState } from './viewState'

const POD_HEALTH_ORDER = {
  failed: 0,
  pending: 1,
  healthy: 2,
  succeeded: 3,
} as const

function readiness(value: string): number | null {
  const [ready, desired] = value.split('/').map(Number)
  if (!Number.isFinite(ready) || !Number.isFinite(desired)) return null
  if (desired === 0) return 1
  return ready! / desired!
}

export function sortKubePods(pods: readonly KubePod[], sort: K8sSortState['pods']): KubePod[] {
  return sortResources(pods, sort, (pod, key): ResourceSortValue => {
    if (key === 'status') return `${POD_HEALTH_ORDER[podHealth(pod)]}:${pod.name}`
    if (key === 'namespace') return pod.namespace
    if (key === 'restarts') return pod.restarts
    if (key === 'created') return sortableTimestamp(pod.createdAt)
    return pod.name
  })
}

/** Health-first related-pod view for a node detail tab, with local name/namespace search. */
export function podsOnNode(pods: readonly KubePod[], nodeName: string, query: string): KubePod[] {
  const needle = query.trim().toLowerCase()
  return sortKubePods(
    pods.filter(
      (pod) =>
        pod.node === nodeName &&
        (!needle ||
          pod.name.toLowerCase().includes(needle) ||
          pod.namespace.toLowerCase().includes(needle)),
    ),
    { key: 'status', direction: 'asc' },
  )
}

export function sortKubeDeployments(
  deployments: readonly KubeDeployment[],
  sort: K8sSortState['deployments'],
): KubeDeployment[] {
  return sortResources(deployments, sort, (deployment, key): ResourceSortValue => {
    if (key === 'status' || key === 'ready') return readiness(deployment.ready)
    if (key === 'namespace') return deployment.namespace
    if (key === 'created') return sortableTimestamp(deployment.createdAt)
    return deployment.name
  })
}

export function sortKubeServices(
  services: readonly KubeService[],
  sort: K8sSortState['services'],
): KubeService[] {
  return sortResources(services, sort, (service, key): ResourceSortValue => {
    if (key === 'type') return service.type
    if (key === 'namespace') return service.namespace
    if (key === 'created') return sortableTimestamp(service.createdAt)
    return service.name
  })
}

export function sortKubeNodes(nodes: readonly KubeNode[], sort: K8sSortState['nodes']): KubeNode[] {
  return sortResources(nodes, sort, (node, key): ResourceSortValue => {
    if (key === 'status') return `${node.status === 'NotReady' ? 0 : 1}:${node.name}`
    if (key === 'role') return node.roles.join(',')
    if (key === 'created') return sortableTimestamp(node.createdAt)
    return node.name
  })
}

export function sortKubePortForwards(
  forwards: readonly PortForward[],
  sort: K8sSortState['portForwards'],
): PortForward[] {
  return sortResources(forwards, sort, (forward, key): ResourceSortValue => {
    if (key === 'namespace') return forward.namespace
    if (key === 'port') return forward.localPort
    if (key === 'created') return sortableTimestamp(forward.createdAt)
    return forward.pod
  })
}
