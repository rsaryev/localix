import { Puzzle } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { DROP_TARGET_INSET_ACTIVE, DROP_TARGET_TRANSITION } from '@localixai/kit/drop-target'
import type { UseRailDnd } from '../model/useRailDnd'
import type { PinnedRailArea } from '../model/railLayout'
import { RailButton } from './RailButton'
import { CustomizableRailButton } from './CustomizableRailButton'
import { RailRecentsDock } from './RailRecentsDock'
import type { RailAction, RailEntry } from './shellTypes'

interface RailWorkspaceGroupProps {
  /** Fixed core destinations rendered above the customizable entries. */
  mainRailActions: RailAction[]
  /** Entries the user placed in this zone (already ordered). */
  barEntries: RailEntry[]
  /** Transient recent slots — plugin views, most recently opened first. */
  recentEntries: RailEntry[]
  /** Ids already seen on the bar; anything else plays the entrance animation. */
  seenIds: ReadonlySet<string> | null
  capabilitiesActive: boolean
  onCapabilitiesClick: () => void
  onMoveToArea: (id: string, area: PinnedRailArea) => void
  onMoveWithinBar: (id: string, area: PinnedRailArea, delta: number) => void
  /** Dismiss one recent slot. */
  onRemoveRecent?: (id: string) => void
  onResetRail: () => void
  dnd: UseRailDnd
}

/**
 * The rail's middle group: fixed core destinations, the user's placed entries, the
 * Dock-style recent slots, and the plugin launcher — all inside one drop
 * zone. The inner min-height wrapper centers short stacks evenly between the top
 * and bottom groups; when the stack grows taller, this outer region scrolls.
 */
export function RailWorkspaceGroup({
  mainRailActions,
  barEntries,
  recentEntries,
  seenIds,
  capabilitiesActive,
  onCapabilitiesClick,
  onMoveToArea,
  onMoveWithinBar,
  onRemoveRecent,
  onResetRail,
  dnd,
}: RailWorkspaceGroupProps) {
  const {
    drag,
    clearDrag,
    onDragStart,
    onDragOverItem,
    onDropItem,
    onZoneDragOver,
    onZoneDragLeave,
    onZoneDrop,
  } = dnd

  return (
    <div
      data-rail-group="workspace"
      data-rail-drop-zone
      data-drop-active={drag.overZone === 'bar' ? 'true' : undefined}
      className={cn(
        'min-h-0 w-full flex-1 overflow-y-auto rounded-xl px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        DROP_TARGET_TRANSITION,
        drag.dragId && 'ring-1 ring-inset ring-foreground/10',
        drag.overZone === 'bar' && DROP_TARGET_INSET_ACTIVE,
      )}
      onDragOver={(event) => onZoneDragOver(event, 'bar')}
      onDragLeave={(event) => onZoneDragLeave(event, 'bar')}
      onDrop={(event) => onZoneDrop(event, 'bar')}
    >
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-1.5 py-3">
        {mainRailActions.map((action) => (
          <RailButton
            key={action.id}
            icon={action.icon}
            label={action.label}
            chordId={action.chordId}
            active={!!action.active}
            onClick={action.onClick}
          />
        ))}
        {barEntries.map((entry, index) => (
          <CustomizableRailButton
            key={entry.id}
            entry={entry}
            area="bar"
            drag={drag}
            isFirst={index === 0}
            isLast={index === barEntries.length - 1}
            justPinned={!seenIds?.has(entry.id)}
            onDragStart={onDragStart}
            onDragOverItem={onDragOverItem}
            onDropItem={onDropItem}
            onDragEnd={clearDrag}
            onMoveWithin={onMoveWithinBar}
            onMoveArea={onMoveToArea}
            onReset={onResetRail}
          />
        ))}
        {/* Recent slots, macOS-Dock style: plugin views float in here as they are
          opened and age out. The dock owns whether they rest collapsed behind one
          disclosure button (the default), expanded, or hidden — see
          shared/lib/railRecentsPref. */}
        <RailRecentsDock
          entries={recentEntries}
          dragging={drag.dragId !== null}
          renderEntry={(entry, { onMenuOpenChange }) => (
            <CustomizableRailButton
              key={entry.id}
              onMenuOpenChange={onMenuOpenChange}
              entry={entry}
              area="bar"
              variant="recent"
              drag={drag}
              isFirst
              isLast
              justPinned={!seenIds?.has(entry.id)}
              onDragStart={onDragStart}
              onDragOverItem={onDragOverItem}
              onDropItem={onDropItem}
              onDragEnd={clearDrag}
              onMoveWithin={onMoveWithinBar}
              onMoveArea={onMoveToArea}
              onRemoveRecent={onRemoveRecent}
              onReset={onResetRail}
            />
          )}
        />
        {/* Fixed launcher for the plugin views, directly below the ones already open. It
          used to double as a drop target for un-pinning a plugin view; nothing is
          pinnable any more, so it is a plain button again. */}
        <RailButton
          icon={<Puzzle className="size-4.5" />}
          label="Plugins"
          active={capabilitiesActive}
          onClick={onCapabilitiesClick}
        />
      </div>
    </div>
  )
}
