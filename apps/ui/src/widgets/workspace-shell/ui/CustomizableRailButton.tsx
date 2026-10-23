import { useState, type ComponentProps } from 'react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { useChordHint } from '@/shared/lib/keybindings'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { requestConfirmation } from '@/shared/lib/confirmAction'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { railBtn, railBtnActive, statusBtnActive } from '@localixai/kit/rail-button'
import { IconButton } from '@localixai/kit/icon-button'
import { WorkbenchStatusButton } from '@localixai/kit/workbench-statusbar'
import {
  DROP_TARGET_INDICATOR_AFTER_HORIZONTAL,
  DROP_TARGET_INDICATOR_AFTER_VERTICAL,
  DROP_TARGET_INDICATOR_BEFORE_HORIZONTAL,
  DROP_TARGET_INDICATOR_BEFORE_VERTICAL,
} from '@localixai/kit/drop-target'
import type { RailDrag } from '../model/railDrag'
import type { PinnedRailArea } from '../model/railLayout'
import type { RailEntry } from './shellTypes'

function RailEntryControl({
  surface,
  ...props
}: ComponentProps<'button'> & {
  surface: 'rail' | 'status'
  'aria-label': string
  children: React.ReactNode
}) {
  return surface === 'status' ? (
    <WorkbenchStatusButton {...props} />
  ) : (
    <IconButton size="touch" {...props} />
  )
}

/**
 * A customizable rail button: drag-reorderable, right-click to hide/reset. The
 * dragged button stays MOUNTED across the whole gesture (same `key`), so its
 * `onDragEnd` always fires — clearing state even on Escape or a drop in dead
 * space.
 *
 * `variant="recent"` renders the same button in one of the rail's transient recent
 * slots (see railRecents). A recent slot cannot be dragged, reordered or pinned —
 * mini app views have no placement at all, so the only thing its menu offers is
 * dismissing it. Core entries keep the full placement menu.
 */
export function CustomizableRailButton({
  entry,
  area,
  drag,
  isFirst,
  isLast,
  justPinned,
  surface = 'rail',
  variant = 'pinned',
  onDragStart,
  onDragOverItem,
  onDropItem,
  onDragEnd,
  onMoveWithin,
  onMoveArea,
  onRemoveRecent,
  onMenuOpenChange,
  onReset,
  onUnpin,
}: {
  entry: RailEntry
  area: PinnedRailArea
  drag: RailDrag
  /** True when the entry sits at the top of the bar (Move up disabled). */
  isFirst: boolean
  /** True when the entry sits at the bottom of the bar (Move down disabled). */
  isLast: boolean
  /** True when the entry just appeared on the bar (plays the entrance animation). */
  justPinned: boolean
  /** Vertical rail button or compact horizontal status-bar control. */
  surface?: 'rail' | 'status'
  /** A user-placed button, or one of the transient recent slots. */
  variant?: 'pinned' | 'recent'
  onDragStart: (e: React.DragEvent, id: string, label: string) => void
  onDragOverItem: (e: React.DragEvent, id: string, area: PinnedRailArea) => void
  onDropItem: (e: React.DragEvent, id: string, area: PinnedRailArea) => void
  onDragEnd: () => void
  onMoveWithin: (id: string, area: PinnedRailArea, delta: number) => void
  onMoveArea: (id: string, area: PinnedRailArea) => void
  /** Dismiss a recent slot. Required for `variant="recent"`. */
  onRemoveRecent?: (id: string) => void
  /** Told when this button's context menu opens or closes. A surface that can be
   *  dismissed from under the button — the recents flyout — needs this to stay put
   *  while the menu it spawned is still on screen. */
  onMenuOpenChange?: (open: boolean) => void
  onReset: () => void
  onUnpin?: (id: string) => void
}) {
  const hint = useChordHint()
  const [tooltipOpen, setTooltipOpen] = useState(false)
  const isRecent = variant === 'recent'
  const isDragging = drag.dragId === entry.id
  const isTarget = !isRecent && drag.dragId !== null && drag.target?.id === entry.id
  const insertionIndicator =
    surface === 'status'
      ? drag.target?.after
        ? DROP_TARGET_INDICATOR_AFTER_VERTICAL
        : DROP_TARGET_INDICATOR_BEFORE_VERTICAL
      : drag.target?.after
        ? DROP_TARGET_INDICATOR_AFTER_HORIZONTAL
        : DROP_TARGET_INDICATOR_BEFORE_HORIZONTAL
  const areaLabels: Record<PinnedRailArea, string> = {
    top: 'Move to top',
    bar: 'Move to workspace',
    bottom: 'Move to lower rail',
    status: 'Move to status bar',
  }
  // Described, not hand-rolled: the walker owns the seams, so the leading/doubled rules a recent
  // slot's shorter list would otherwise leave behind never reach the screen.
  const menu: MenuEntry[] = [
    // What the button's owner adds (a mini app's app actions) leads, above the rail's own rows.
    ...(entry.extraMenu?.length
      ? [...entry.extraMenu.map((item) => ({ ...item })), { separator: true } as const]
      : []),
    ...((entry.miniApp || entry.toolCategory !== undefined) && !isRecent && onUnpin
      ? [{ id: 'unpin', label: 'Unpin from rail', onSelect: () => onUnpin(entry.id) }]
      : []),
    ...(isRecent
      ? ([
          {
            id: 'remove-recent',
            label: 'Remove from recents',
            onSelect: () => onRemoveRecent?.(entry.id),
          },
        ] satisfies MenuEntry[])
      : ([
          {
            id: 'move-back',
            label: surface === 'status' ? 'Move left' : 'Move up',
            disabled: isFirst,
            onSelect: () => onMoveWithin(entry.id, area, -1),
          },
          {
            id: 'move-forward',
            label: surface === 'status' ? 'Move right' : 'Move down',
            disabled: isLast,
            onSelect: () => onMoveWithin(entry.id, area, 1),
          },
          { separator: true },
          ...(Object.keys(areaLabels) as PinnedRailArea[])
            .filter((targetArea) => targetArea !== area)
            .map((targetArea) => ({
              id: `move-${targetArea}`,
              label: areaLabels[targetArea],
              onSelect: () => onMoveArea(entry.id, targetArea),
            })),
        ] satisfies MenuEntry[])),
    { separator: true },
    {
      id: 'reset-rail',
      label: 'Reset rail to defaults…',
      // Asked first: this discards EVERY button's placement across all four areas plus the recents,
      // not just this one's — and the row sits one separator away from "Move up".
      onSelect: () =>
        requestConfirmation({
          kind: 'reset-rail',
          title: 'Reset the rail to defaults?',
          detail:
            'Every button goes back to its default place across the rail, the lower rail and the status bar, and the recent slots are cleared. This cannot be undone.',
          confirmLabel: 'Reset rail',
          variant: 'destructive',
          perform: onReset,
        }),
    },
  ]
  return (
    <ContextMenu onOpenChange={onMenuOpenChange}>
      <ActionTooltip
        label={hint(isRecent ? `${entry.label} · recent` : entry.label, entry.chordId)}
        side={surface === 'status' ? 'top' : 'right'}
        open={isDragging ? false : tooltipOpen}
        onOpenChange={(open) => setTooltipOpen(isDragging ? false : open)}
      >
        <ContextMenuTrigger asChild>
          <RailEntryControl
            surface={surface}
            aria-label={entry.label}
            className={cn(
              surface === 'status'
                ? 'relative h-full w-8 cursor-grab rounded-none bg-transparent text-text-faint hover:bg-surface-hover hover:text-text-soft active:cursor-grabbing [&_svg]:size-3.5'
                : railBtn,
              entry.active && (surface === 'status' ? statusBtnActive : railBtnActive),
              surface === 'status' && entry.statusLabel && 'w-auto gap-1.5 px-2',
              isDragging && 'opacity-40',
              justPinned && 'animate-in fade-in zoom-in-90 duration-(--dur-base)',
              // A recent slot is transient, so it rests dimmer than a placed one —
              // the same signal as the hairline above it.
              isRecent && !entry.active && 'text-text-faint hover:text-text-soft',
              // Insertion guide: a line hugging the edge the dragged entry lands on.
              isTarget && insertionIndicator,
            )}
            draggable={!isRecent}
            onClick={entry.onClick}
            aria-current={entry.active ? 'true' : undefined}
            onDragStart={
              isRecent
                ? undefined
                : (e) => {
                    setTooltipOpen(false)
                    onDragStart(e, entry.id, entry.label)
                  }
            }
            onDragOver={isRecent ? undefined : (e) => onDragOverItem(e, entry.id, area)}
            onDrop={isRecent ? undefined : (e) => onDropItem(e, entry.id, area)}
            onDragEnd={onDragEnd}
          >
            {entry.icon}
            {surface === 'status' && entry.statusLabel && <span>{entry.statusLabel}</span>}
          </RailEntryControl>
        </ContextMenuTrigger>
      </ActionTooltip>
      <ContextMenuContent>
        <MenuEntries entries={menu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
