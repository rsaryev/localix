import { memo } from 'react'
import { ScrollText, Share2, Trash2 } from 'lucide-react'
import type { KubePod, PodUsage } from '../../../backend/contracts'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { IconButton } from '@localixai/kit/icon-button'
import { StatusDot } from '@localixai/kit/status-dot'
import { ResourceDragRow } from '../../../../ui/ResourceDragRow'
import { podDotClass, podStatusLabel } from '../../model/groupPods'
import { formatResourceAge } from '../../../../ui/model/resourceAge'
import { formatCpu, formatMemory } from '../../model/usage'
import { KUBERNETES_RESOURCE_GRID } from '../KubernetesListHeader'
import { buildK8sPodUri } from '../../model/resourceLink'

/** What a pod row can ask for. Each handler takes the pod, so a list needs ONE
 *  stable handler per action instead of one closure per row — which is what makes the
 *  memo below actually skip unchanged rows. */
export interface PodRowActions {
  onOpen: (pod: KubePod) => void
  onForward: (pod: KubePod) => void
  /** Raise the sidebar's delete confirmation. The row never deletes anything itself. */
  onDeleteRequest: (pod: KubePod) => void
}

/** One pod: status dot, ready/restarts/age columns, a draggable row surface, and
 * hover Logs/Forward/Delete actions — reachable by right-click too, because the hover buttons
 * do not exist on a touch or keyboard pass. */
function PodRowView({
  pod,
  context,
  usage,
  showNamespace = false,
  busy,
  actions,
}: {
  pod: KubePod
  context: string
  /** Live usage for this pod. Absent when the cluster serves no metrics API, or when
   *  this pod has no sample yet — both render as no usage rather than as zeros. */
  usage?: PodUsage
  showNamespace?: boolean
  busy: boolean
  actions: PodRowActions
}) {
  const age = formatResourceAge(pod.createdAt)
  // Usage leads the metadata cell because the cell is justify-end and clips from the
  // START: in a narrow sidebar the optional column is what should disappear first,
  // never ready/restarts/age.
  const cpu = usage ? formatCpu(usage.cpuNanos) : ''
  const memory = usage ? formatMemory(usage.memoryBytes) : ''
  // Context drag/staging is available once the ref URI has a resolved context.
  const dragUri = context
    ? buildK8sPodUri({ context, namespace: pod.namespace, name: pod.name })
    : undefined
  // Right-click reaches everything the hover cluster does. The buttons only exist on hover, and a
  // touch or keyboard pass never has one — the same argument the Docker rows already settled.
  const menu: MenuEntry[] = [
    {
      id: 'open',
      label: 'Open pod details',
      icon: ScrollText,
      onSelect: () => actions.onOpen(pod),
    },
    ...(pod.phase === 'Running'
      ? ([
          {
            id: 'forward',
            label: 'Forward port…',
            icon: Share2,
            onSelect: () => actions.onForward(pod),
          },
        ] satisfies MenuEntry[])
      : []),
    { separator: true },
    {
      id: 'delete',
      label: 'Delete pod…',
      icon: Trash2,
      danger: true,
      disabled: busy,
      onSelect: () => actions.onDeleteRequest(pod),
    },
  ]
  const row = (
    <ResourceDragRow
      uri={dragUri}
      label={pod.name}
      onOpen={() => actions.onOpen(pod)}
      className={cn(KUBERNETES_RESOURCE_GRID, 'group/row px-3 py-0.5 hover:bg-surface-hover')}
    >
      <button
        type="button"
        data-resource-drag-surface
        onClick={() => actions.onOpen(pod)}
        className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-ring"
        aria-label={`${pod.name}, ${podStatusLabel(pod)}${showNamespace ? `, namespace ${pod.namespace}` : ''}`}
        title={`${podStatusLabel(pod)}\nReady ${pod.ready} · ${pod.restarts} restarts${pod.node ? `\nNode ${pod.node}` : ''}\nOpen pod details`}
      >
        <StatusDot size="md" className={podDotClass(pod)} />
        <span className="truncate text-xs text-sidebar-foreground">{pod.name}</span>
        {showNamespace && (
          <span
            className="max-w-32 shrink-0 truncate text-2xs text-text-faint"
            title={pod.namespace}
          >
            {pod.namespace}
          </span>
        )}
      </button>

      <span
        data-resource-column="meta"
        className="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden text-2xs tabular-nums text-text-faint"
      >
        {cpu && (
          <span title="CPU · live usage" className="text-text-soft">
            {cpu}
          </span>
        )}
        {memory && (
          <span title="Memory · live usage" className="text-text-soft">
            {memory}
          </span>
        )}
        <span title="Ready containers">{pod.ready}</span>
        {pod.restarts > 0 && (
          <span title="Restarts" className="text-status-warning">
            ↻{pod.restarts}
          </span>
        )}
        {age && <span title="Age">{age}</span>}
      </span>
      <span
        data-resource-column="action"
        className="lx-hover-actions flex min-w-0 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
      >
        <IconButton size="xs" aria-label="Logs" tooltip="Logs" onClick={() => actions.onOpen(pod)}>
          <ScrollText className="size-3" />
        </IconButton>
        {pod.phase === 'Running' && (
          <IconButton
            size="xs"
            aria-label="Forward port"
            tooltip="Forward port"
            onClick={() => actions.onForward(pod)}
          >
            <Share2 className="size-3" />
          </IconButton>
        )}
        <IconButton
          size="xs"
          aria-label="Delete"
          tooltip="Delete"
          disabled={busy}
          onClick={() => actions.onDeleteRequest(pod)}
        >
          <Trash2 className="size-3" />
        </IconButton>
      </span>
    </ResourceDragRow>
  )
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={menu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const PodRow = memo(PodRowView)
