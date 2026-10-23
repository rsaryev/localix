import { Boxes } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { StatusDot } from '@localixai/kit/status-dot'
import type { KubePod } from '../../backend/contracts'
import { ResourceDragRow } from '../../../ui/ResourceDragRow'
import { ResourceListHeader } from '../../../ui/ResourceListHeader'
import { podDotClass, podStatusLabel } from '../model/groupPods'
import { formatResourceAge } from '../../../ui/model/resourceAge'
import { openKubernetesPodTab } from '../model/openTab'
import { buildK8sPodUri } from '../model/resourceLink'

export const RELATED_POD_GRID =
  'grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 @sm:grid-cols-[minmax(0,1fr)_11rem]'

export function RelatedPodListHeader({ primary }: { primary: string }) {
  return (
    <ResourceListHeader gridClassName={RELATED_POD_GRID}>
      <span className="min-w-0 truncate">{primary}</span>
      <span className="truncate text-right">Ready · restarts · age</span>
    </ResourceListHeader>
  )
}

/** Read-only pod relation used inside node and workload detail tabs. */
export function RelatedPodRow({
  pod,
  context,
  showNamespace = false,
}: {
  pod: KubePod
  context?: string
  showNamespace?: boolean
}) {
  // The pod tab opens in the chat of the tab this row sits in; with none there is nowhere to open.
  const sessionId = useWorkItemSessionId()
  const open = () => {
    if (sessionId) openKubernetesPodTab(sessionId, pod.name, pod.namespace, context, pod)
  }
  return (
    <ResourceDragRow
      uri={buildK8sPodUri({ context, namespace: pod.namespace, name: pod.name })}
      label={pod.name}
      onOpen={open}
      className={cn(RELATED_POD_GRID, 'group/row px-3 py-1.5 hover:bg-surface-hover')}
    >
      <button
        type="button"
        data-resource-drag-surface
        className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left outline-none focus-ring"
        title={`Open ${pod.namespace}/${pod.name}`}
        onClick={open}
      >
        <StatusDot size="md" className={podDotClass(pod)} />
        <Boxes className="size-3.5 shrink-0 text-text-faint" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs text-foreground">{pod.name}</span>
          <span className="truncate text-2xs text-text-faint">
            {showNamespace ? `${pod.namespace} · ` : ''}
            {podStatusLabel(pod)}
          </span>
        </span>
      </button>
      <span
        data-resource-column="meta"
        className="flex min-w-0 items-center justify-end gap-1.5 truncate text-2xs tabular-nums text-text-faint"
      >
        <span title="Ready containers">{pod.ready}</span>
        {pod.restarts > 0 && (
          <span title="Restarts" className="text-status-warning">
            ↻{pod.restarts}
          </span>
        )}
        <span title="Age">{formatResourceAge(pod.createdAt) || '—'}</span>
      </span>
    </ResourceDragRow>
  )
}
