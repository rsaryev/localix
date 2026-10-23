import { PanelHeader } from '@localixai/kit/panel-header'
import { RefreshAction } from '@localixai/kit/refresh-action'
import type { ResourceSort } from '../../../ui/model/resourceSort'
import type { ClusterPulse } from '../model/clusterPulse'
import type { KubeIssue } from '../model/kubernetesState'
import type { KubernetesWorkbenchModel } from '../model/useKubernetes'
import {
  K8S_SORT_OPTIONS,
  type K8sResourceView,
  type K8sSortKey,
  type K8sViewState,
} from '../model/viewState'
import { KubernetesPulse } from './KubernetesPulse'
import { KubernetesResourceBar, RESOURCE_META } from './KubernetesResourceBar'
import { SidebarControls } from './SidebarControls'

export function KubernetesSidebarHeader({
  kubernetes,
  embedded,
  view,
  counts,
  errors,
  pulse,
  onFilterChange,
  onResourceChange,
  onSortChange,
}: {
  kubernetes: KubernetesWorkbenchModel
  embedded: boolean
  view: K8sViewState
  counts: Record<K8sResourceView, number>
  errors: Partial<Record<K8sResourceView, KubeIssue>>
  pulse: ClusterPulse
  onFilterChange: (filter: string) => void
  onResourceChange: (resource: K8sResourceView) => void
  onSortChange: (sort: ResourceSort<K8sSortKey>) => void
}) {
  const refresh = () =>
    kubernetes.unavailable || kubernetes.unreachable || kubernetes.error
      ? kubernetes.retryBootstrap()
      : void kubernetes.refresh({ forceSecondary: true })

  return (
    <>
      {!embedded && (
        <PanelHeader
          title="Kubernetes"
          tone="content"
          actions={
            <RefreshAction
              aria-label="Refresh"
              tooltip="Refresh"
              busy={kubernetes.refreshing}
              onClick={refresh}
            />
          }
        />
      )}

      {kubernetes.contexts.length > 0 && (
        <SidebarControls
          contexts={kubernetes.contexts}
          currentContext={kubernetes.currentContext}
          activeContext={kubernetes.activeContext}
          setActiveContext={kubernetes.setActiveContext}
          namespaces={kubernetes.namespaces}
          activeNamespace={kubernetes.activeNamespace}
          setActiveNamespace={kubernetes.setActiveNamespace}
          filter={view.filter}
          setFilter={onFilterChange}
          resourceLabel={RESOURCE_META[view.resource].label}
          sort={view.sort[view.resource]}
          sortOptions={K8S_SORT_OPTIONS[view.resource]}
          setSort={onSortChange}
          actions={
            embedded ? (
              <RefreshAction
                aria-label="Refresh"
                tooltip="Refresh"
                busy={kubernetes.refreshing}
                onClick={refresh}
              />
            ) : undefined
          }
        />
      )}

      {!kubernetes.loading &&
        !kubernetes.unavailable &&
        !kubernetes.unreachable &&
        !kubernetes.error && (
          <>
            <KubernetesPulse pulse={pulse} />
            <KubernetesResourceBar
              value={view.resource}
              counts={counts}
              errors={errors}
              onChange={onResourceChange}
            />
          </>
        )}
    </>
  )
}
