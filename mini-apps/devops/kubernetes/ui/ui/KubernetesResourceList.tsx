import { EmptyHint } from '@localixai/kit/empty-hint'
import {
  KubernetesDeploymentsList,
  KubernetesNodesList,
  KubernetesPortForwardsList,
  KubernetesServicesList,
} from './KubernetesClusterLists'
import { KubernetesPodsList, KubernetesWorkloadsList } from './KubernetesPodLists'
import type { KubernetesResourceListProps } from './resourceListTypes'

/**
 * Routes the selected inventory kind to a focused renderer. Filtering, sorting,
 * row actions, and empty-state wording live with each resource family.
 */
export function KubernetesResourceList(props: KubernetesResourceListProps) {
  if (!props.namespace && props.resource !== 'nodes' && props.resource !== 'portForwards') {
    return <EmptyHint className="p-4">Select a namespace to browse resources.</EmptyHint>
  }

  switch (props.resource) {
    case 'workloads':
      return <KubernetesWorkloadsList {...props} />
    case 'pods':
      return <KubernetesPodsList {...props} />
    case 'deployments':
      return <KubernetesDeploymentsList {...props} />
    case 'services':
      return <KubernetesServicesList {...props} />
    case 'nodes':
      return <KubernetesNodesList {...props} />
    case 'portForwards':
      return <KubernetesPortForwardsList {...props} />
  }
}
