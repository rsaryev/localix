import { LoadingHint } from '@localixai/kit/empty-hint'
import type { KubeIssue } from '../model/kubernetesState'
import type { KubernetesWorkbenchModel } from '../model/useKubernetes'
import type { KubernetesSidebarActions } from '../model/useKubernetesSidebarActions'
import type { K8sResourceView, K8sViewState } from '../model/viewState'
import type { NodeUsage, PodUsage } from '../../backend/contracts'
import { DevOpsProblem } from '../../../ui/DevOpsProblem'
import { KubernetesResourceList } from './KubernetesResourceList'
import { RESOURCE_META } from './KubernetesResourceBar'

/** A failed read with no last good rows is UNKNOWN, not an authoritative empty list. */
export function shouldRenderResourceSnapshot(
  issue: KubeIssue | null | undefined,
  rowCount: number,
): boolean {
  return !issue || rowCount > 0
}

export function KubernetesSidebarInventory({
  kubernetes,
  view,
  counts,
  errors,
  podUsage,
  nodeUsage,
  actions,
}: {
  kubernetes: KubernetesWorkbenchModel
  view: K8sViewState
  counts: Record<K8sResourceView, number>
  errors: Partial<Record<K8sResourceView, KubeIssue>>
  podUsage: Map<string, PodUsage>
  nodeUsage: Map<string, NodeUsage>
  actions: KubernetesSidebarActions
}) {
  const activeError = errors[view.resource]
  const { loading, unavailable, unreachable, error } = kubernetes
  // The cluster-level failure, or null. Every problem owner below stays MOUNTED and is handed null
  // when healthy: rendered inside a branch, each one unmounted exactly when its failure ended, so
  // its Event Center row was never settled.
  const clusterIssue: KubeIssue | null = loading
    ? null
    : unavailable
      ? (error ?? { message: 'No usable kubeconfig was found.' })
      : unreachable || error
        ? (error ?? { message: 'Cannot reach this cluster right now.' })
        : null
  const collectionIssue = loading || clusterIssue ? null : (activeError ?? null)
  return (
    <div className="@container scrollbar-thin min-h-0 flex-1 overflow-y-auto">
      {loading && <LoadingHint className="p-3">Loading cluster…</LoadingHint>}
      <DevOpsProblem
        centered
        subject={unavailable ? 'Kubernetes setup' : 'Cluster'}
        issue={clusterIssue}
        onRetry={kubernetes.retryBootstrap}
      />
      <DevOpsProblem
        subject={RESOURCE_META[view.resource].label}
        issue={collectionIssue}
        centered={counts[view.resource] === 0}
        onRetry={() => void kubernetes.refresh({ forceSecondary: true })}
      />
      {!loading && !clusterIssue && (
        <>
          {shouldRenderResourceSnapshot(activeError, counts[view.resource]) && (
            <KubernetesResourceList
              resource={view.resource}
              sort={view.sort[view.resource]}
              query={view.filter}
              context={kubernetes.activeContext}
              namespace={kubernetes.activeNamespace}
              pods={kubernetes.pods}
              deployments={kubernetes.deployments}
              services={kubernetes.services}
              nodes={kubernetes.nodes}
              portForwards={kubernetes.portForwards}
              podUsage={podUsage}
              nodeUsage={nodeUsage}
              pendingPods={actions.pendingPods}
              onForward={actions.requestPortForward}
              onDeleteRequest={actions.requestDelete}
              onScale={actions.requestScale}
              onRestart={actions.requestRestart}
              onNodeAction={actions.requestNodeAction}
              onStopForward={(id) => void actions.stopForward(id)}
            />
          )}
        </>
      )}
    </div>
  )
}
