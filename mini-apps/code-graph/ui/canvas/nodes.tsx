import { memo } from 'react'
import { ArrowUpRight, ChevronRight } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { HiddenHandles, type Node, type NodeProps } from '@localixai/kit/canvas'
import type { GraphNodeData, NodeEmphasis } from '../model/flow'
import { GROUP } from '../model/layout'
import { KIND_ICON, KIND_TINT } from '../kinds'

/**
 * The boxes on the map, drawn to be scanned rather than read: an icon tinted by kind, a name, and
 * one quiet chip — how much uses it. Everything else is one click away in the inspector.
 * A container is a frame with its contents inside; a portal is dashed, so code outside the level
 * never reads as part of it. Handles exist for edge routing and are invisible.
 */

// Dimmed boxes recede but stay readable: at 30% their names were lost on a dark theme, and a
// person tracing one box's connections still needs to read the ones around it.
const EMPHASIS: Record<NodeEmphasis, string> = {
  focus: 'border-status-info/80 ring-2 ring-status-info/20',
  neighbor: 'border-status-info/50',
  idle: '',
  dimmed: 'opacity-45',
}

/** How much of the project uses a box: a labelled chip, never a bare number to decode. */
function UsedBy({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <span
      className="shrink-0 rounded-sm bg-surface-hover px-1 font-mono text-3xs leading-4 text-text-soft tabular-nums"
      title={`Used by ${count} reference${count === 1 ? '' : 's'} from outside it`}
    >
      {count}
    </span>
  )
}

function GroupNodeImpl({ data }: NodeProps<Node<GraphNodeData>>) {
  const { node, emphasis, highlighted } = data
  const Icon = KIND_ICON[node.kind]
  const count =
    node.kind === 'directory'
      ? `${node.size} file${node.size === 1 ? '' : 's'}`
      : `${node.size} members`
  return (
    <div
      className={cn(
        'group/container relative h-full w-full cursor-pointer rounded-xl border border-border-soft transition-[opacity,border-color,box-shadow] duration-(--dur-fast) hover:border-border',
        EMPHASIS[emphasis],
        highlighted &&
          emphasis !== 'focus' &&
          'border-status-warning/70 ring-2 ring-status-warning/20',
      )}
    >
      <HiddenHandles />
      <div
        className="flex items-center gap-1.5 rounded-t-xl bg-surface-raised px-3"
        style={{ height: GROUP.header }}
      >
        <Icon aria-hidden className={cn('size-3.5 shrink-0', KIND_TINT[node.kind])} />
        <span className="min-w-0 truncate text-xs font-medium text-foreground">{node.name}</span>
        <span className="shrink-0 text-3xs text-text-faint">{count}</span>
        <span className="ml-auto" />
        <UsedBy count={node.dependents} />
        <ChevronRight
          aria-hidden
          className="size-3.5 shrink-0 text-text-faint opacity-0 transition-opacity duration-(--dur-fast) group-hover/container:opacity-100"
        />
      </div>
      {(node.hiddenTiles ?? 0) > 0 && (
        <div className="absolute bottom-1.5 left-3 text-3xs text-text-faint">
          +{node.hiddenTiles} more
        </div>
      )}
    </div>
  )
}

function BoxNodeImpl({ data }: NodeProps<Node<GraphNodeData>>) {
  const { node, emphasis, highlighted } = data
  const portal = node.role === 'portal'
  const Icon = portal ? ArrowUpRight : KIND_ICON[node.kind]
  return (
    <div
      className={cn(
        'flex h-full w-full cursor-pointer items-center gap-2 rounded-lg border px-2.5 transition-[opacity,border-color,box-shadow] duration-(--dur-fast)',
        portal
          ? 'border-dashed border-border bg-transparent hover:border-text-faint'
          : 'border-border-soft bg-card shadow-(--shadow-soft) hover:border-border',
        EMPHASIS[emphasis],
        highlighted &&
          emphasis !== 'focus' &&
          'border-status-warning/70 ring-2 ring-status-warning/20',
      )}
    >
      <HiddenHandles />
      <Icon
        aria-hidden
        className={cn('size-3.5 shrink-0', portal ? 'text-text-faint' : KIND_TINT[node.kind])}
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate',
          node.role === 'tile' ? 'text-2xs' : 'text-xs',
          portal ? 'text-text-soft' : 'text-foreground',
        )}
        title={portal ? `${node.path || node.name} (outside this level)` : node.name}
      >
        {portal && node.path ? node.path : node.name}
      </span>
      {!portal && <UsedBy count={node.dependents} />}
    </div>
  )
}

export const GroupNode = memo(GroupNodeImpl)
export const BoxNode = memo(BoxNodeImpl)
