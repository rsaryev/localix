import { Ellipsis } from 'lucide-react'
import type { MiniAppCategory } from '@localixai/mini-app-sdk/manifest'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { DROP_TARGET_INSET_ACTIVE, DROP_TARGET_TRANSITION } from '@localixai/kit/drop-target'
import type { UseRailDnd } from '../model/useRailDnd'
import type { PinnedRailArea } from '../model/railLayout'
import { RailButton } from './RailButton'
import { CustomizableRailButton } from './CustomizableRailButton'
import { RailRecentsDock } from './RailRecentsDock'
import { RailToolGroups } from './RailToolGroups'
import { RailToolMenu } from './RailToolMenu'
import { RailAddMiniApp } from './RailAddMiniApp'
import { RailToolMenuGroup } from './RailToolMenuGroup'
import type { RailAction, RailEntry } from './shellTypes'
import { isRailTool } from '../model/railToolGroups'

interface RailWorkspaceGroupProps {
  /** Fixed core destinations rendered above the customizable entries. */
  mainRailActions: RailAction[]
  /** Entries the user placed in this zone (already ordered). */
  barEntries: RailEntry[]
  toolEntries: RailEntry[]
  miniAppCategories?: ReadonlyMap<string, MiniAppCategory | undefined>
  pinnedToolIds: ReadonlySet<string>
  onPinTool: (id: string, pinned: boolean) => void
  onUnpinTool: (id: string) => void
  /** Transient recent slots — plugin views, most recently opened first. */
  recentEntries: RailEntry[]
  /** Ids already seen on the bar; anything else plays the entrance animation. */
  seenIds: ReadonlySet<string> | null
  miniAppsPending: boolean
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
  toolEntries,
  miniAppCategories,
  pinnedToolIds,
  onPinTool,
  onUnpinTool,
  recentEntries,
  seenIds,
  miniAppsPending,
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
    <RailToolMenuGroup>
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
          {barEntries
            .filter((entry) => !isRailTool(entry))
            .map((entry) => (
              <CustomizableRailButton
                key={entry.id}
                entry={entry}
                area="bar"
                drag={drag}
                isFirst={barEntries[0]?.id === entry.id}
                isLast={barEntries.at(-1)?.id === entry.id}
                justPinned={!seenIds?.has(entry.id)}
                onDragStart={onDragStart}
                onDragOverItem={onDragOverItem}
                onDropItem={onDropItem}
                onDragEnd={clearDrag}
                onMoveWithin={onMoveWithinBar}
                onMoveArea={onMoveToArea}
                onReset={onResetRail}
                onUnpin={onUnpinTool}
              />
            ))}
          <RailToolGroups
            entries={barEntries.filter(isRailTool)}
            categories={miniAppCategories}
            renderEntry={(entry) => (
              <CustomizableRailButton
                key={entry.id}
                entry={entry}
                area="bar"
                drag={drag}
                isFirst={barEntries[0]?.id === entry.id}
                isLast={barEntries.at(-1)?.id === entry.id}
                justPinned={!seenIds?.has(entry.id)}
                onDragStart={onDragStart}
                onDragOverItem={onDragOverItem}
                onDropItem={onDropItem}
                onDragEnd={clearDrag}
                onMoveWithin={onMoveWithinBar}
                onMoveArea={onMoveToArea}
                onReset={onResetRail}
                onUnpin={onUnpinTool}
              />
            )}
          />
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
          {/* Full tool catalog with inline pins and a link to mini app settings; then the store. */}
          <RailToolMenu
            entries={toolEntries}
            categories={miniAppCategories}
            pinnedIds={pinnedToolIds}
            onPinChange={onPinTool}
            icon={<Ellipsis />}
            label="All tools"
            active={false}
            pending={miniAppsPending}
            onManage={onCapabilitiesClick}
          />
          <RailAddMiniApp />
        </div>
      </div>
    </RailToolMenuGroup>
  )
}
