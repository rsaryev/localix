import { useMemo } from 'react'
import { clusterPulse } from '../model/clusterPulse'
import type { KubeIssue } from '../model/kubernetesState'
import type { KubernetesWorkbenchModel } from '../model/useKubernetes'
import { useKubernetesSidebarActions } from '../model/useKubernetesSidebarActions'
import { useUsageMetrics } from '../model/useUsageMetrics'
import { loadK8sView, saveK8sView, type K8sResourceView } from '../model/viewState'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import { useSidebarView } from '../../../ui/model/useSidebarView'
import { KubernetesSidebarDialogs } from './KubernetesSidebarDialogs'
import { KubernetesSidebarHeader } from './KubernetesSidebarHeader'
import { KubernetesSidebarInventory } from './KubernetesSidebarInventory'

/** Provider view with its data lifecycle injected by the DevOps Workspace shell. */
export function KubernetesSidebarView({
  kubernetes,
  requestedResource,
  embedded = false,
}: {
  kubernetes: KubernetesWorkbenchModel
  requestedResource?: K8sResourceView
  embedded?: boolean
}) {
  const { view, setFilter, setResource, setSort } = useSidebarView(
    loadK8sView,
    saveK8sView,
    requestedResource,
  )
  const actions = useKubernetesSidebarActions(kubernetes)
  const pulse = useMemo(
    () => clusterPulse(kubernetes.pods, kubernetes.deployments, kubernetes.nodes),
    [kubernetes.pods, kubernetes.deployments, kubernetes.nodes],
  )
  const counts: Record<K8sResourceView, number> = {
    workloads: kubernetes.deployments.length + kubernetes.pods.length,
    pods: kubernetes.pods.length,
    deployments: kubernetes.deployments.length,
    services: kubernetes.services.length,
    nodes: kubernetes.nodes.length,
    portForwards: kubernetes.portForwards.length,
  }
  const errors: Partial<Record<K8sResourceView, KubeIssue>> = {
    ...kubernetes.resourceErrors,
    workloads: kubernetes.resourceErrors.deployments ?? kubernetes.resourceErrors.pods,
  }
  const { podUsage, nodeUsage } = useUsageMetrics({
    enabled:
      !kubernetes.loading &&
      !kubernetes.unavailable &&
      !kubernetes.unreachable &&
      !kubernetes.error,
    context: kubernetes.activeContext,
    namespace: kubernetes.activeNamespace,
    wantPods: view.resource === 'pods' || view.resource === 'workloads',
    wantNodes: view.resource === 'nodes',
  })

  return (
    <div className="@container flex h-full flex-col">
      <KubernetesSidebarHeader
        kubernetes={kubernetes}
        embedded={embedded}
        view={view}
        counts={counts}
        errors={errors}
        pulse={pulse}
        onFilterChange={setFilter}
        onResourceChange={setResource}
        onSortChange={setSort}
      />

      <DevOpsProblem
        // Stable subject; the sentence is the title. See the note in KubernetesPodTab.
        subject="Kubernetes actions"
        title={actions.actionError?.title}
        issue={actions.actionError?.issue}
        onDismiss={actions.dismissActionError}
      />

      <KubernetesSidebarInventory
        kubernetes={kubernetes}
        view={view}
        counts={counts}
        errors={errors}
        podUsage={podUsage}
        nodeUsage={nodeUsage}
        actions={actions}
      />
      <KubernetesSidebarDialogs kubernetes={kubernetes} actions={actions} />
    </div>
  )
}
