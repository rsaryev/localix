import type { DockerContainer, DockerImage } from '../../docker/backend/contracts'
import type { DockerCollection } from '../../docker/ui/model/useDocker'
import type { KubeDeployment, KubeNode, KubePod } from '../../kubernetes/backend/contracts'
import { clusterPulse, type ClusterPulse } from '../../kubernetes/ui/model/clusterPulse'
import type { KubeCollection, KubeIssue } from '../../kubernetes/ui/model/kubernetesState'
import type { DevOpsArea } from './devopsView'
import {
  prerequisiteHint,
  prerequisiteTitle,
  type Prerequisite,
} from '@localixai/mini-app-sdk/prerequisite'

interface DockerOverviewSource {
  containers: readonly DockerContainer[]
  images: readonly DockerImage[]
  unavailable: boolean
  /** The classified sentence plus the engine's raw words, kept apart. */
  error: { message: string; detail?: string; prerequisite?: Prerequisite } | null
  resourceErrors: Partial<Record<DockerCollection, { message: string; detail?: string }>>
}

interface KubernetesOverviewSource {
  pods: KubePod[]
  deployments: KubeDeployment[]
  nodes: KubeNode[]
  unavailable: boolean
  unreachable: boolean
  error: KubeIssue | null
  resourceErrors: Partial<Record<KubeCollection, KubeIssue>>
}

export interface DevOpsIssue {
  key: string
  label: string
  detail: string
  area: Exclude<DevOpsArea, 'overview'>
}

export interface DevOpsOverviewSnapshot {
  docker: {
    running: number
    containers: number
    images: number
    projects: number
  }
  kubernetes: ClusterPulse
  issues: DevOpsIssue[]
}

function collectionLabel(collection: string): string {
  return `${collection[0]!.toUpperCase()}${collection.slice(1)}`
}

function dockerIssues(docker: DockerOverviewSource): DevOpsIssue[] {
  if (docker.unavailable) {
    // The same words the Containers pane uses — "Docker is not running · Start Docker with `open -a
    // Docker`" — so the overview and the pane cannot describe one engine two ways.
    const prerequisite = docker.error?.prerequisite
    return [
      {
        key: 'docker-unavailable',
        label: prerequisite ? prerequisiteTitle(prerequisite) : 'Container engine is offline',
        detail: prerequisite
          ? prerequisiteHint(prerequisite)
          : 'Start Docker or install a compatible engine.',
        area: 'containers',
      },
    ]
  }
  if (docker.error) {
    return [
      {
        key: 'docker-error',
        label: 'Container inventory did not refresh',
        detail: docker.error.message,
        area: 'containers',
      },
    ]
  }

  return Object.entries(docker.resourceErrors).flatMap(([collection, issue]) =>
    issue
      ? [
          {
            key: `docker-${collection}-error`,
            label: `${collectionLabel(collection)} did not refresh`,
            detail: issue.message,
            area: 'containers' as const,
          },
        ]
      : [],
  )
}

function kubernetesIssues(
  kubernetes: KubernetesOverviewSource,
  pulse: ClusterPulse,
): DevOpsIssue[] {
  if (kubernetes.unavailable) {
    return [
      {
        key: 'kube-unavailable',
        label: 'Kubernetes is not configured',
        detail: kubernetes.error?.message ?? 'Add a usable kubeconfig context.',
        area: 'kubernetes',
      },
    ]
  }
  if (kubernetes.unreachable) {
    return [
      {
        key: 'kube-unreachable',
        label: 'Cluster unavailable',
        detail: 'Open Kubernetes to retry the connection.',
        area: 'kubernetes',
      },
    ]
  }
  if (kubernetes.error) {
    return [
      {
        key: 'kube-error',
        label: 'Kubernetes is temporarily unavailable',
        detail: 'Open Kubernetes to retry.',
        area: 'kubernetes',
      },
    ]
  }

  const issues: DevOpsIssue[] = Object.entries(kubernetes.resourceErrors).flatMap(
    ([collection, issue]) =>
      issue
        ? [
            {
              key: `kube-${collection}-error`,
              label: `${collectionLabel(collection)} did not refresh`,
              detail: issue.message,
              area: 'kubernetes' as const,
            },
          ]
        : [],
  )

  // Health from a failed collection is only a stale snapshot. Its refresh issue is
  // actionable; repeating old health warnings beside it adds noise and false urgency.
  if (!kubernetes.resourceErrors.pods && pulse.pods.faults > 0) {
    issues.push({
      key: 'unhealthy-pods',
      label: `${pulse.pods.faults} pod${pulse.pods.faults === 1 ? '' : 's'} need attention`,
      detail: 'Pending, failed, or not-ready workloads are visible in the pod view.',
      area: 'kubernetes',
    })
  }
  if (!kubernetes.resourceErrors.deployments) {
    const deployments = pulse.deployments.total - pulse.deployments.ready
    if (deployments > 0) {
      issues.push({
        key: 'unready-deployments',
        label: `${deployments} deployment${deployments === 1 ? '' : 's'} not ready`,
        detail: 'Open Deployments to inspect rollout state and owned pods.',
        area: 'kubernetes',
      })
    }
  }
  if (!kubernetes.resourceErrors.nodes) {
    const nodes = pulse.nodes.total - pulse.nodes.ready
    if (nodes > 0) {
      issues.push({
        key: 'unready-nodes',
        label: `${nodes} node${nodes === 1 ? '' : 's'} not ready`,
        detail: 'Open Nodes to inspect scheduling and health.',
        area: 'kubernetes',
      })
    }
  }

  return issues
}

export function devOpsOverviewSnapshot(
  docker: DockerOverviewSource,
  kubernetes: KubernetesOverviewSource,
): DevOpsOverviewSnapshot {
  const pulse = clusterPulse(kubernetes.pods, kubernetes.deployments, kubernetes.nodes)
  return {
    docker: {
      running: docker.containers.filter((container) => container.state === 'running').length,
      containers: docker.containers.length,
      images: docker.images.length,
      projects: new Set(docker.containers.map((container) => container.project).filter(Boolean))
        .size,
    },
    kubernetes: pulse,
    issues: [...dockerIssues(docker), ...kubernetesIssues(kubernetes, pulse)],
  }
}
