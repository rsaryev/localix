import { memo } from 'react'
import { ExternalLink, Trash2 } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { IconButton } from '@localixai/kit/icon-button'
import { ResourceDragRow } from '../../../ui/ResourceDragRow'
import { DOCKER_RESOURCE_GRID } from './DockerListHeader'

/** The muted "No X." placeholder shown inside a collapsible section with no items. */
export function EmptyRow({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-1 text-2xs text-text-faint">{children}</div>
}

/** A generic image/volume/network row: a draggable open surface, metadata, and an
 * independent remove action. */
function ResourceRowView({
  icon,
  label,
  titleText,
  meta,
  secondaryMeta,
  dragUri,
  dragLabel,
  removeLabel = 'Remove',
  onOpen,
  onRemove,
}: {
  icon: React.ReactNode
  /** Row label — a string, or rich content (pass `titleText` for the hover title). */
  label: React.ReactNode
  /** Hover title for the label; defaults to the label when it is a plain string. */
  titleText?: string
  meta: string
  secondaryMeta?: string
  dragUri?: string
  dragLabel?: string
  removeLabel?: string
  onOpen?: () => void
  onRemove?: () => void
}) {
  const title = titleText ?? (typeof label === 'string' ? label : undefined)
  const resourceLabel = dragLabel ?? title ?? 'Docker resource'
  // Right-click reaches what the row can do. The remove button only exists on hover, and on a
  // touch or keyboard pass there is no hover to reveal it.
  const menu: MenuEntry[] = [
    ...(onOpen
      ? ([
          { id: 'open', label: 'Open details', icon: ExternalLink, onSelect: onOpen },
        ] satisfies MenuEntry[])
      : []),
    ...(onRemove
      ? ([
          {
            id: 'remove',
            label: `${removeLabel}…`,
            icon: Trash2,
            danger: true,
            onSelect: onRemove,
          },
        ] satisfies MenuEntry[])
      : []),
  ]
  const row = (
    <ResourceDragRow
      uri={dragUri}
      label={resourceLabel}
      onOpen={onOpen}
      className={cn(
        DOCKER_RESOURCE_GRID,
        'group/row px-3 py-1 text-xs text-text-soft hover:bg-surface-hover',
      )}
    >
      <button
        type="button"
        data-resource-drag-surface
        disabled={!onOpen}
        onClick={onOpen}
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-sm text-left outline-none focus-ring',
          onOpen ? 'cursor-pointer' : 'cursor-default',
        )}
        title={onOpen ? `${title ?? 'Resource'} · open details` : title}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      <span className="truncate text-right tabular-nums text-2xs text-text-faint">{meta}</span>
      <span
        className="hidden truncate text-right text-2xs text-text-faint @md:block"
        title={secondaryMeta}
      >
        {secondaryMeta ?? '—'}
      </span>
      <span data-resource-column="action" className="flex min-w-0 items-center justify-end">
        {onRemove && (
          <IconButton
            size="xs"
            aria-label={removeLabel}
            tooltip={removeLabel}
            className="lx-hover-actions opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100"
            onClick={onRemove}
          >
            <Trash2 className="size-3" />
          </IconButton>
        )}
      </span>
    </ResourceDragRow>
  )
  // A row with neither an open nor a remove handler has nothing to offer; an empty menu that
  // opens on right-click is worse than the native nothing.
  if (menu.length === 0) return row
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={menu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}

export const ResourceRow = memo(ResourceRowView)
