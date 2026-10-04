import type {
  KubeDeployment,
  KubeNode,
  KubePod,
  KubeService,
  NodeUsage,
  PodUsage,
  PortForward,
} from '../../backend/contracts'
import type { ResourceSort } from '../../../ui/model/resourceSort'
import type { K8sResourceView, K8sSortKey } from '../model/viewState'
import type { NodeAction } from './SidebarRows'

export interface KubernetesResourceListProps {
  resource: K8sResourceView
  sort: ResourceSort<K8sSortKey>
  query: string
  context: string
  namespace: string
  pods: KubePod[]
  deployments: KubeDeployment[]
  services: KubeService[]
  nodes: KubeNode[]
  portForwards: PortForward[]
  /** Live pod usage indexed by `namespace/name`; empty when the cluster serves no
   * metrics API, so every row lookup is a clean miss rather than a zero. */
  podUsage: Map<string, PodUsage>
  /** Live node usage indexed by node name. */
  nodeUsage: Map<string, NodeUsage>
  pendingPods: Record<string, boolean>
  onForward: (pod: KubePod) => void
  /** Raise the delete confirmation. The sidebar owns the dialog and the act behind it. */
  onDeleteRequest: (pod: KubePod) => void
  onScale: (deployment: KubeDeployment) => void
  onRestart: (deployment: KubeDeployment) => void
  onNodeAction: (node: KubeNode, action: NodeAction) => void
  onStopForward: (id: string) => void
}
