import { useEffect, useRef } from 'react'
import { Menu, Plus } from 'lucide-react'
import type { PluginCategory } from '@localixai/plugin-sdk/manifest'
import { CMD } from '@/shared/lib/keybindings'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { DROP_TARGET_INSET_ACTIVE, DROP_TARGET_TRANSITION } from '@localixai/kit/drop-target'
import type { UseRailDnd } from '../model/useRailDnd'
import type { PinnedRailArea } from '../model/railLayout'
import { RailButton, RailDivider } from './RailButton'
import { RailWorkspaceGroup } from './RailWorkspaceGroup'
import { CustomizableRailButton } from './CustomizableRailButton'
import type { RailAction, RailEntry } from './shellTypes'

interface WorkspaceRailProps {
  onCreateChat: () => void
  createChatBusy?: boolean
  historyActive: boolean
  onHistoryClick: () => void
  /** Customizable entries currently placed with chat navigation. */
  topEntries: RailEntry[]
  /** Customizable entries currently pinned to the bar (already ordered). */
  barEntries: RailEntry[]
  toolEntries: RailEntry[]
  pluginCategories?: ReadonlyMap<string, PluginCategory | undefined>
  pinnedToolIds: ReadonlySet<string>
  onPinTool: (id: string, pinned: boolean) => void
  onUnpinTool: (id: string) => void
  /** Customizable entries currently placed in the lower group. */
  bottomEntries: RailEntry[]
  /** Transient recent slots — plugin views, most recently opened first. */
  recentEntries?: RailEntry[]
  /** Append an entry to any visible placement zone. */
  onMoveToArea: (id: string, area: PinnedRailArea) => void
  /** Keyboard reorder: nudge a bar entry by `delta` positions. */
  onMoveWithinBar: (id: string, area: PinnedRailArea, delta: number) => void
  /** Dismiss one recent slot. */
  onRemoveRecent?: (id: string) => void
  onResetRail: () => void
  pluginsPending: boolean
  onCapabilitiesClick: () => void
  dnd: UseRailDnd
  /** Fixed destinations that stay with chat navigation at the top. */
  topRailActions: RailAction[]
  /** Fixed core destinations rendered in the middle workspace group. */
  mainRailActions: RailAction[]
  /** FIXED actions pinned to the bottom (e.g. Settings). */
  bottomRailActions: RailAction[]
  /** Host utilities shown alongside Settings and other system destinations. */
  systemRailActions: RailAction[]
}

const NO_RECENT_ENTRIES: RailEntry[] = []

/**
 * The vertical navigation rail, read as three hairline-separated groups: the fixed
 * NAVIGATION group (new chat, history) → the WORKSPACE group (fixed core
 * destinations, customizable plugin entries, and the plugin launcher) → the fixed SYSTEM group
 * (settings and update). Rendered in both the desktop
 * and mobile nav slots; the persisted layout is owned once by the shell, so both
 * stay in sync.
 */
export function WorkspaceRail({
  onCreateChat,
  createChatBusy = false,
  historyActive,
  onHistoryClick,
  topEntries,
  barEntries,
  toolEntries,
  pluginCategories,
  pinnedToolIds,
  onPinTool,
  onUnpinTool,
  bottomEntries,
  recentEntries = NO_RECENT_ENTRIES,
  onMoveToArea,
  onMoveWithinBar,
  onRemoveRecent,
  onResetRail,
  pluginsPending,
  onCapabilitiesClick,
  dnd,
  topRailActions,
  mainRailActions,
  bottomRailActions,
  systemRailActions,
}: WorkspaceRailProps) {
  const barIds = barEntries.map((entry) => entry.id)
  const settingsAction = bottomRailActions.find((action) => action.id === 'settings')
  const bottomDestinations = bottomRailActions.filter((action) => action.id !== 'settings')

  // Transient drag machine for the middle zone. Every terminal path (drop on an
  // item, drop on overflow, drop in dead space, Escape, drop outside) funnels back
  // to IDLE via clearDrag, so no indicator can get stuck.
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

  // Entrance animation for entries freshly ARRIVED in the workspace group —
  // pinned or recent (tabs.tsx seenIds pattern): ids present on first render are
  // pre-seeded, and every rendered id is marked seen afterwards, so mounts and
  // reorders never re-animate. One shared ledger across both stacks means pinning
  // a recent (recents → bar) does not replay the animation for an icon that was
  // already on screen; only a genuinely new slot plays it.
  const recentIds = recentEntries.map((entry) => entry.id)
  const seenBarIds = useRef<Set<string> | null>(null)
  if (seenBarIds.current === null) seenBarIds.current = new Set([...barIds, ...recentIds])
  useEffect(() => {
    const seen = seenBarIds.current
    if (seen) for (const id of [...barIds, ...recentIds]) seen.add(id)
  })

  // The seen-id ref is an animation ledger; reading it does not derive UI data and
  // avoids a re-render that would cut a fresh entrance short.
  // eslint-disable-next-line react-hooks/refs
  const seenIds = seenBarIds.current

  // The upper and lower rails place their entries the same way: in order, no entrance animation.
  const placedEntries = (entries: RailEntry[], area: 'top' | 'bottom') =>
    entries.map((entry, index) => (
      <CustomizableRailButton
        key={entry.id}
        entry={entry}
        area={area}
        drag={drag}
        isFirst={index === 0}
        isLast={index === entries.length - 1}
        justPinned={false}
        onDragStart={onDragStart}
        onDragOverItem={onDragOverItem}
        onDropItem={onDropItem}
        onDragEnd={clearDrag}
        onMoveWithin={onMoveWithinBar}
        onMoveArea={onMoveToArea}
        onReset={onResetRail}
        onUnpin={onUnpinTool}
      />
    ))

  return (
    <div className="flex h-full min-h-0 flex-col items-center py-2 pb-3.5">
      {/* Group 1 — fixed chat anchors + customizable upper navigation. */}
      <div
        data-rail-group="navigation"
        data-top-rail-drop-zone
        data-drop-active={drag.overZone === 'top' ? 'true' : undefined}
        className={cn(
          'flex w-full shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-1',
          DROP_TARGET_TRANSITION,
          drag.dragId && 'ring-1 ring-inset ring-foreground/10',
          drag.overZone === 'top' && DROP_TARGET_INSET_ACTIVE,
        )}
        onDragOver={(event) => onZoneDragOver(event, 'top')}
        onDragLeave={(event) => onZoneDragLeave(event, 'top')}
        onDrop={(event) => onZoneDrop(event, 'top')}
      >
        <RailButton
          icon={<Plus className="size-4.5" />}
          label="New chat"
          chordId={CMD.newChat}
          active={false}
          onClick={onCreateChat}
          disabled={createChatBusy}
        />
        <RailButton
          icon={<Menu className="size-4.5" />}
          label="Chat history"
          active={historyActive}
          onClick={onHistoryClick}
        />
        <div className="mt-2 flex flex-col items-center gap-1">
          {topRailActions.map((action) => (
            <RailButton
              key={action.id}
              icon={action.icon}
              label={action.label}
              chordId={action.chordId}
              active={!!action.active}
              onClick={action.onClick}
            />
          ))}
          {placedEntries(topEntries, 'top')}
        </div>
      </div>

      <RailDivider />

      {/* Group 2 — centered WORKSPACE destinations, customizable plugin entries,
          the recent slots, and the plugin launcher. */}
      <RailWorkspaceGroup
        mainRailActions={mainRailActions}
        barEntries={barEntries}
        toolEntries={toolEntries}
        pluginCategories={pluginCategories}
        pinnedToolIds={pinnedToolIds}
        onPinTool={onPinTool}
        onUnpinTool={onUnpinTool}
        recentEntries={recentEntries}
        seenIds={seenIds}
        pluginsPending={pluginsPending}
        onCapabilitiesClick={onCapabilitiesClick}
        onMoveToArea={onMoveToArea}
        onMoveWithinBar={onMoveWithinBar}
        onRemoveRecent={onRemoveRecent}
        onResetRail={onResetRail}
        dnd={dnd}
      />

      <RailDivider />

      {/* Group 3 — fixed SYSTEM actions pinned to the bottom. */}
      <div
        data-rail-group="system"
        data-bottom-rail-drop-zone
        data-drop-active={drag.overZone === 'bottom' ? 'true' : undefined}
        className={cn(
          'flex shrink-0 flex-col items-center gap-1 rounded-xl px-1 py-1',
          DROP_TARGET_TRANSITION,
          drag.dragId && 'ring-1 ring-inset ring-foreground/10',
          drag.overZone === 'bottom' && DROP_TARGET_INSET_ACTIVE,
        )}
        onDragOver={(event) => onZoneDragOver(event, 'bottom')}
        onDragLeave={(event) => onZoneDragLeave(event, 'bottom')}
        onDrop={(event) => onZoneDrop(event, 'bottom')}
      >
        {settingsAction ? (
          <RailButton
            icon={settingsAction.icon}
            label={settingsAction.label}
            chordId={settingsAction.chordId}
            active={!!settingsAction.active}
            activeAria="pressed"
            onClick={settingsAction.onClick}
          />
        ) : null}
        {[...bottomDestinations, ...systemRailActions].map((action) => (
          <RailButton
            key={action.id}
            icon={action.icon}
            label={action.label}
            chordId={action.chordId}
            active={!!action.active}
            activeAria="pressed"
            onClick={action.onClick}
          />
        ))}
        {placedEntries(bottomEntries, 'bottom')}
      </div>
    </div>
  )
}
