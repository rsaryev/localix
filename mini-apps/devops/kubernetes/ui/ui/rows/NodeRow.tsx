import { memo } from 'react'
import { Ban, CircleCheck, Droplets, Server } from 'lucide-react'
import type { KubeNode } from '../../../backend/contracts'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { IconButton } from '@localixai/kit/icon-button'
import { StatusDot } from '@localixai/kit/status-dot'
import { ResourceDragRow } from '../../../../ui/ResourceDragRow'
import { formatResourceAge } from '../../../../ui/model/resourceAge'
import { formatUsageShare, type NodeUsageDisplay } from '../../model/usage'
import { KUBERNETES_RESOURCE_GRID } from '../KubernetesListHeader'
import { buildK8sNodeUri } from '../../model/resourceLink'

export type NodeAction = 'cordon' | 'uncordon' | 'drain'

/** Confirm-dialog copy for each node action. Drain is destructive (it evicts pods). */
export const NODE_ACTION_META: Record<
  NodeAction,
  { title: string; description: string; confirmLabel: string }
> = {
  cordon: {
    title: 'Cordon',
    description:
      'Marks the node unschedulable — no NEW pods will be scheduled onto it. Existing pods keep running. Reversible with Uncordon.',
    confirmLabel: 'Cordon',
  },
  uncordon: {
    title: 'Uncordon',
    description: 'Marks the node schedulable again so new pods can be placed on it.',
    confirmLabel: 'Uncordon',
  },
  drain: {
    title: 'Drain',
    description:
      'DESTRUCTIVE: cordons the node AND evicts its pods (--ignore-daemonsets --delete-emptydir-data --force). Pods reschedule elsewhere; emptyDir data on this node is lost. Times out after 120s.',
    confirmLabel: 'Drain node',
  },
}

function usageTitle(usage: NodeUsageDisplay | null, age: string): string | undefined {
  const parts = [
    usage && `CPU ${formatUsageShare(usage.cpu, usage.cpuPercent)} of allocatable`,
    usage && `Memory ${formatUsageShare(usage.memory, usage.memoryPercent)} of allocatable`,
    age && `Age ${age}`,
  ].filter(Boolean)
  return parts.length ? parts.join('\n') : undefined
}

/** What a node row can ask for. Each handler takes the node, so a list needs ONE
 *  stable handler per action instead of one closure per row. */
export interface NodeRowActions {
  onOpen: (node: KubeNode) => void
  onCordon: (node: KubeNode) => void
  onUncordon: (node: KubeNode) => void
  onDrain: (node: KubeNode) => void
}

/** One cluster node: status dot (Ready/NotReady), roles + version, live usage against
 *  allocatable, a cordoned tag when unschedulable, and hover-revealed Cordon/Uncordon +
 *  Drain actions — reachable by right-click too, since a hover cluster does not exist on a touch
 *  or keyboard pass. */
function NodeRowView({
  node,
  context,
  usage = null,
  actions,
}: {
  node: KubeNode
  context?: string
  /** Live usage for this node; `null` when the cluster serves no metrics API or this
   *  node has no sample yet. */
  usage?: NodeUsageDisplay | null
  actions: NodeRowActions
}) {
  const rolesLabel = node.roles.length ? node.roles.join(',') : '<none>'
  const age = formatResourceAge(node.createdAt)
  const resourceUri = context ? buildK8sNodeUri({ context, name: node.name }) : undefined
  const menu: MenuEntry[] = [
    { id: 'open', label: 'Open node details', icon: Server, onSelect: () => actions.onOpen(node) },
    { separator: true },
    node.schedulable
      ? {
          id: 'cordon',
          label: 'Cordon…',
          icon: Ban,
          onSelect: () => actions.onCordon(node),
        }
      : {
          id: 'uncordon',
          label: 'Uncordon…',
          icon: CircleCheck,
          onSelect: () => actions.onUncordon(node),
        },
    {
      id: 'drain',
      // Danger, unlike Cordon: draining EVICTS the node's pods and loses their emptyDir data.
      // Same split the confirm copy in NODE_ACTION_META already makes.
      label: 'Drain…',
      icon: Droplets,
      danger: true,
      onSelect: () => actions.onDrain(node),
    },
  ]
  const row = (
    <ResourceDragRow
      uri={resourceUri}
      label={node.name}
      onOpen={() => actions.onOpen(node)}
      className={cn(
        KUBERNETES_RESOURCE_GRID,
        'group/row px-3 py-1.5 text-xs text-text-soft hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        data-resource-drag-surface
        onClick={() => actions.onOpen(node)}
        className="flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-ring"
        title={`${node.name}\nOpen node details`}
      >
        <StatusDot
          size="md"
          label={node.status}
          className={node.status === 'Ready' ? 'bg-status-success' : 'bg-status-error'}
        />
        <Server className="size-3 shrink-0 text-text-faint" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{node.name}</span>
          <span className="truncate text-2xs text-text-faint">
            {rolesLabel}
            {node.version ? ` · ${node.version}` : ''}
            {!node.schedulable && <span className="ml-1 text-status-warning">· cordoned</span>}
          </span>
        </span>
      </button>
      <span
        data-resource-column="meta"
        className="flex min-w-0 items-center justify-end gap-1.5 overflow-hidden text-right text-2xs tabular-nums text-text-faint"
        title={usageTitle(usage, age)}
      >
        {usage && (
          // Percentages, not raw amounts, are what a node row is read for: "is this node
          // full?" needs a denominator, and the row already has one in `allocatable`.
          <span className="truncate text-text-soft">
            {formatUsageShare(usage.cpu, usage.cpuPercent)}
            {' · '}
            {formatUsageShare(usage.memory, usage.memoryPercent)}
          </span>
        )}
        <span className="truncate">
          {node.status}
          {age ? ` · ${age}` : ''}
        </span>
      </span>
      <span
        data-resource-column="action"
        className="lx-hover-actions flex min-w-0 items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
      >
        {node.schedulable ? (
          <IconButton
            size="xs"
            aria-label="Cordon"
            tooltip="Cordon (make unschedulable)"
            onClick={() => actions.onCordon(node)}
          >
            <Ban className="size-3" />
          </IconButton>
        ) : (
          <IconButton
            size="xs"
            aria-label="Uncordon"
            tooltip="Uncordon (make schedulable)"
            onClick={() => actions.onUncordon(node)}
          >
            <CircleCheck className="size-3" />
          </IconButton>
        )}
        <IconButton
          size="xs"
          aria-label="Drain"
          tooltip="Drain (evict pods)"
          onClick={() => actions.onDrain(node)}
        >
          <Droplets className="size-3" />
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

export const NodeRow = memo(NodeRowView)
