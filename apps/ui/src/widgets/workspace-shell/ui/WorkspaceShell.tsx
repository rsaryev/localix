import { type ReactNode, useEffect } from 'react'
import { Menu } from 'lucide-react'
import { isDesktop } from '@localixai/kit/environment'
import { IS_MAC } from '@localixai/kit/environment'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { DROP_TARGET_INSET_ACTIVE, DROP_TARGET_TRANSITION } from '@localixai/kit/drop-target'
import { IconButton } from '@localixai/kit/icon-button'
import { WorkbenchSash } from '@localixai/kit/button'
import { WorkbenchStatusHost, WorkbenchStatusOutlet } from '@localixai/kit/workbench-statusbar'
import { StatusItems, useHasStatusItems } from '@/shared/contrib/statusItems'
import { TransientStatusLine } from '@/shared/ui/notification-center/TransientStatusLine'
import { useBrowserHistoryAgent } from '@/features/inspector/ui/useBrowserHistoryAgent'
import { SIDEBAR_WIDTH_VAR, useSidebarResize } from '../model/useSidebarResize'
import { useRailLayout } from '../model/useRailLayout'
import { useRailTools } from '../model/useRailTools'
import { useRailDnd } from '../model/useRailDnd'
import { buildRailEntries } from '../model/buildRailEntries'
import type { RailEntry } from './shellTypes'
import type { PluginCategory } from '@localixai/plugin-sdk/manifest'
import { CustomizableRailButton } from './CustomizableRailButton'
import { WorkspaceRail } from './WorkspaceRail'
import type { RailAction, RailSection } from './shellTypes'

/**
 * The app frame: rail + resizable sidebar + main content + status bar.
 *
 * The main content is whatever `children` is — today the editor GRID, which owns
 * its own splits and tabs. The shell deliberately knows nothing about them: it
 * used to carry a rival two-dock layout engine (a `panels` array with left/right/
 * bottom docks, drag-to-dock edge zones, reopen handles and full-screen "main
 * views") which the grid superseded. That machinery was still wired but provably
 * inert — nothing passed `panels`/`mainViews`, and nothing ever STARTED a panel or
 * section drag — so it has been removed rather than left to rot as a second,
 * plausible-looking way to lay out the workspace.
 */
interface WorkspaceShellProps {
  /** Selects one responsive shell tree. Desktop and mobile must not be mounted together:
   *  CSS visibility would hide one visually but still run every sidebar effect twice. */
  isMobile: boolean
  sidebarOpen: boolean
  sidebarContent?: ReactNode
  railSections?: RailSection[]
  activeSectionId?: string | null
  onSectionChange?: (id: string | null) => void
  /** Action buttons rendered in the rail's top group, after the sections. */
  railActions?: RailAction[]
  /** True while the catalog's enabled-plugin set is still loading. */
  pluginsPending?: boolean
  pluginCategories?: ReadonlyMap<string, PluginCategory | undefined>
  capabilitiesManageUri?: string
  onNavigateUi?: (uri: string) => void
  onOpenSidebar: () => void
  onCloseSidebar: () => void
  onCreateChat: () => void
  createChatBusy?: boolean
  /** Full-width status bar pinned to the very bottom, spanning the whole app. */
  footer?: ReactNode
  /** The chat whose contributed status items the status bar shows — the page's open chat, given
   *  by the page (the shell does not read the active session itself); null when none is open. */
  statusSessionId: string | null
  /** Compact status in the existing desktop titlebar or mobile header.
   * Hidden status must release its width instead of leaving an empty trailing slot. */
  headerStatus?: ReactNode
  /** Interactive chrome rendered in the app-wide top bar (breadcrumb + workspace
   *  utilities). On macOS desktop it lives in the draggable titlebar strip next to the
   *  traffic lights (so content should be discrete interactive islands); in the
   *  browser / Windows / Linux it renders in a plain non-draggable top bar. Hidden
   *  on mobile widths. When omitted, no top bar is drawn. */
  titlebarContent?: ReactNode
  /** `app`: a plugin installed as its own app (`shared/lib/pluginApp.ts`). Its window is the
   *  plugin, so the workspace's own frame (rail, sidebar, top bar, status bar) is not drawn. */
  chrome?: 'workspace' | 'app'
  children: ReactNode
}

const NO_RAIL_SECTIONS: RailSection[] = []
const NO_RAIL_ACTIONS: RailAction[] = []

function resolveRailEntries(ids: readonly string[], entries: ReadonlyMap<string, RailEntry>) {
  const resolved: RailEntry[] = []
  for (const id of ids) {
    const entry = entries.get(id)
    if (entry) resolved.push(entry)
  }
  return resolved
}

export function WorkspaceShell({
  isMobile,
  sidebarOpen,
  sidebarContent,
  railSections = NO_RAIL_SECTIONS,
  activeSectionId,
  onSectionChange,
  railActions = NO_RAIL_ACTIONS,
  pluginsPending = false,
  pluginCategories,
  capabilitiesManageUri,
  onNavigateUi,
  onOpenSidebar,
  onCloseSidebar,
  onCreateChat,
  createChatBusy = false,
  footer,
  statusSessionId,
  headerStatus,
  titlebarContent,
  chrome = 'workspace',
  children,
}: WorkspaceShellProps) {
  const frame = chrome === 'workspace'
  useBrowserHistoryAgent()
  // Contributed status items are session-scoped (`statusSessionId`), and whether any exist decides
  // whether the status row is worth mounting at all when nothing else claims it.
  const hasStatusItems = useHasStatusItems('statusbar')
  const activeSection = activeSectionId !== undefined ? activeSectionId : null
  const registeredSectionContent =
    railSections.find((section) => section.id === activeSection)?.content ?? null

  const {
    sidebarWidth,
    resizing,
    onResizeStart,
    onResizeKeyDown,
    resetWidth,
    panelRef: sidebarPanelRef,
    sashRef: sidebarSashRef,
    min: sidebarMin,
    max: sidebarMax,
  } = useSidebarResize()

  useEffect(() => {
    if (!sidebarOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [sidebarOpen])

  const historyActive = sidebarOpen && activeSection === null

  const handleHistoryClick = () => {
    if (historyActive) {
      onCloseSidebar()
    } else {
      onSectionChange?.(null)
      onOpenSidebar()
    }
  }

  const handleSectionClick = (id: string) => {
    if (sidebarOpen && activeSection === id) {
      onCloseSidebar()
    } else {
      onSectionChange?.(id)
      onOpenSidebar()
    }
  }

  // Split rail actions into customizable workspace views and fixed utilities.
  const customizableActions: RailAction[] = []
  const bottomRailActions: RailAction[] = []
  const topRailActions: RailAction[] = []
  const mainRailActions: RailAction[] = []
  const utilityOverflowActions: RailAction[] = []
  for (const action of railActions) {
    if (action.customizable) {
      customizableActions.push(action)
      continue
    }
    if (action.railPosition === 'bottom') bottomRailActions.push(action)
    if (action.railPosition === 'top') topRailActions.push(action)
    if (!action.railPosition && action.overflowGroup !== 'utilities') mainRailActions.push(action)
    if (action.overflowGroup === 'utilities') utilityOverflowActions.push(action)
  }

  const customizableSections: RailSection[] = []
  const fixedSectionActions: RailAction[] = []
  for (const section of railSections) {
    if (section.customizable !== false) {
      customizableSections.push(section)
      continue
    }
    fixedSectionActions.push({
      id: `section:${section.id}`,
      icon: section.icon,
      label: section.label,
      active: sidebarOpen && activeSection === section.id,
      onClick: () => handleSectionClick(section.id),
      railPosition: 'top',
    })
  }

  // Unify sidebar SECTIONS + workspace VIEWS into one customizable entry set with
  // stable, namespaced ids (see buildRailEntries).
  const { entryMap: railEntryMap, defs: railDefs } = buildRailEntries({
    railSections: customizableSections,
    customizableActions,
    sidebarOpen,
    activeSection,
    onSectionClick: handleSectionClick,
  })

  const railLayout = useRailLayout(railDefs)

  const {
    recents,
    pinnedIds: pinnedToolIds,
    launchableEntryMap,
    toolEntries,
    pinTool,
    unpinTool,
  } = useRailTools(railEntryMap, railLayout)

  const barEntries = resolveRailEntries(railLayout.bar, railEntryMap)
  const bottomEntries = resolveRailEntries(railLayout.bottom, railEntryMap)
  const topEntries = resolveRailEntries(railLayout.top, railEntryMap)
  const statusEntries = resolveRailEntries(railLayout.status, railEntryMap)
  const recentEntries = resolveRailEntries(recents.ids, launchableEntryMap)

  // "Reset layout" reads as EVERYTHING, so it clears the recent slots too.
  const resetRail = () => {
    railLayout.reset()
    recents.clear()
  }

  const entriesByArea = {
    top: topEntries,
    bar: barEntries,
    bottom: bottomEntries,
    status: statusEntries,
  }
  const moveToArea = (id: string, area: keyof typeof entriesByArea) => {
    const ids = entriesByArea[area]
    railLayout.move(id, area, ids.filter((entry) => entry.id !== id).length)
  }
  // Pinned tools share the same placement and drag model as core entries.
  const railDnd = useRailDnd({
    areaIds: {
      top: topEntries.map((entry) => entry.id),
      bar: barEntries.map((entry) => entry.id),
      bottom: bottomEntries.map((entry) => entry.id),
      status: statusEntries.map((entry) => entry.id),
    },
    onMoveEntry: railLayout.move,
  })
  const activeSectionContent = registeredSectionContent

  const rail = (
    <WorkspaceRail
      onCreateChat={onCreateChat}
      createChatBusy={createChatBusy}
      historyActive={historyActive}
      onHistoryClick={handleHistoryClick}
      barEntries={barEntries}
      toolEntries={toolEntries}
      pluginCategories={pluginCategories}
      pinnedToolIds={pinnedToolIds}
      onPinTool={pinTool}
      onUnpinTool={unpinTool}
      topEntries={topEntries}
      bottomEntries={bottomEntries}
      recentEntries={recentEntries}
      onMoveToArea={moveToArea}
      onMoveWithinBar={railLayout.moveWithin}
      onRemoveRecent={recents.remove}
      onResetRail={resetRail}
      pluginsPending={pluginsPending}
      onCapabilitiesClick={() => {
        if (capabilitiesManageUri) onNavigateUi?.(capabilitiesManageUri)
      }}
      dnd={railDnd}
      topRailActions={[...fixedSectionActions, ...topRailActions]}
      mainRailActions={mainRailActions}
      bottomRailActions={bottomRailActions}
      systemRailActions={utilityOverflowActions}
    />
  )
  return (
    // One status bar per window: the shell owns it, and the focused editor
    // CONTRIBUTES its Ln/Col + indentation + language into it (see
    // workbench-status-host). The host must wrap both the content and the bar,
    // so the contribution can reach the outlet from inside `children`.
    <WorkbenchStatusHost>
      {/* `app-shell-ground`, not `bg-background`: on opaque themes it paints the same token, but
          under macOS glass it goes fully transparent. The shell spans the WHOLE window — if it
          painted here, the glassy side panels would composite ON TOP of the dense work-area tone
          and come out darker than the centre, the exact inversion of the design. Each region
          (grid, rail, sidebar, bars) paints its own ground exactly once instead. */}
      <div className="app-shell-ground flex h-dvh w-full flex-col overflow-hidden">
        {/* App-wide top bar hosting the navigation breadcrumb — kept at the very top
          in EVERY shell (browser, Windows/Linux, macOS) so the project → session
          path is always up top, never buried inside the chat. Hidden on mobile
          widths (the mobile header below takes over). Two variants:
          - macOS desktop: a DRAGGABLE breadcrumb toolbar beside the system
            traffic lights. AppKit measures their gap and the native tab band.
            `data-tauri-drag-region` makes the strip drag the window (Tauri reads the
            attribute, not the CSS -webkit-app-region property); double-click zooms.
          - everywhere else (browser + Windows/Linux, which keep their native OS
            titlebar): a plain, non-draggable bar with no traffic-light gap. */}
        {!isMobile &&
          titlebarContent &&
          // A plugin app's page sits under its own window's macOS titlebar, like the desktop's.
          ((isDesktop && IS_MAC) || !frame ? (
            <div
              data-tauri-drag-region
              className="app-titlebar flex h-[var(--titlebar-height)] shrink-0 items-center gap-1 border-b border-border-soft bg-sidebar pr-2 max-sm:hidden lg:pr-1"
            >
              {titlebarContent}
              {headerStatus}
            </div>
          ) : (
            <div className="flex h-[var(--titlebar-height)] shrink-0 items-center gap-1 border-b border-border-soft bg-sidebar px-2 max-sm:hidden lg:px-1">
              {titlebarContent}
              {headerStatus}
            </div>
          ))}

        <div className="app-native-tabbar-space" aria-hidden="true" />

        {/* Mobile header */}
        {frame && isMobile && (
          <header className="relative z-(--z-overlay) flex h-[var(--mobile-header-height)] shrink-0 items-center gap-2.5 border-b border-sidebar-border bg-background px-2">
            <IconButton
              size="touch"
              className={sidebarOpen ? 'text-foreground' : 'text-text-soft hover:text-foreground'}
              onClick={sidebarOpen ? onCloseSidebar : onOpenSidebar}
              aria-label="Chat history"
            >
              <Menu className="size-4.5" />
            </IconButton>
            <span className="text-2xs tracking-widest text-text-faint">LOCALIX CHAT</span>
            <div className="ml-auto shrink-0">{headerStatus}</div>
          </header>
        )}

        {/* Body */}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Desktop: rail + inline sidebar panel */}
          {frame && !isMobile && (
            <div className="flex h-full shrink-0 flex-row">
              <nav
                className="flex h-full w-[var(--workbench-rail-width)] shrink-0 flex-col border-r border-sidebar-border bg-sidebar"
                aria-label="Workspace navigation"
              >
                {rail}
              </nav>

              {(sidebarContent || activeSectionContent) && (
                <div
                  ref={sidebarPanelRef}
                  className={[
                    'flex h-full flex-row overflow-hidden bg-sidebar transition-[width] duration-(--dur-base) ease-(--ease-soft) relative',
                    sidebarOpen ? 'border-r border-sidebar-border' : '',
                  ].join(' ')}
                  // The width is painted from `--sidebar-width`, which the resize hook
                  // writes straight to this element during a drag — so dragging the sash
                  // repaints without re-rendering the shell (and everything under it).
                  style={
                    {
                      [SIDEBAR_WIDTH_VAR]: `${sidebarWidth}px`,
                      width: sidebarOpen ? `var(${SIDEBAR_WIDTH_VAR})` : 0,
                      ...(resizing ? { transition: 'none' } : null),
                    } as React.CSSProperties
                  }
                >
                  <div
                    data-focus-part={sidebarOpen ? 'sidebar' : undefined}
                    className="min-w-0 shrink-0"
                    style={{ width: `var(${SIDEBAR_WIDTH_VAR})` }}
                  >
                    {activeSectionContent ?? sidebarContent}
                  </div>
                  {/* The shared sash owns hit geometry and feedback; this surface owns
                    only placement and resize mechanics. */}
                  {sidebarOpen && (
                    <WorkbenchSash
                      ref={sidebarSashRef}
                      orientation="vertical"
                      label="Resize sidebar"
                      resetLabel="reset sidebar width"
                      valueMin={sidebarMin}
                      valueMax={sidebarMax}
                      valueNow={sidebarWidth}
                      valueText={`${Math.round(sidebarWidth)} pixels`}
                      active={resizing}
                      className="absolute -right-[calc(var(--sash-hit-area)/2)] top-0 z-(--z-controls) h-full"
                      onMouseDown={onResizeStart}
                      onKeyDown={onResizeKeyDown}
                      onDoubleClick={resetWidth}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          <main className="relative flex flex-1 min-w-0 min-h-0 overflow-hidden">
            <div
              data-center-column
              className="relative flex flex-1 min-w-0 min-h-0 flex-col overflow-hidden"
            >
              <section className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                {children}
              </section>
            </div>
          </main>
        </div>

        {/* The full-width status bar is the fourth placement zone. Host status
          segments stay on the left; compact customizable controls occupy the right. */}
        {frame && (footer || statusEntries.length > 0 || hasStatusItems) && (
          <div
            data-status-rail-drop-zone
            data-drop-active={railDnd.drag.overZone === 'status' ? 'true' : undefined}
            className={cn(
              // `bg-sidebar`, not `bg-surface-raised`: the status bar is window CHROME, like the
              // titlebar and the rail, and all chrome shares the sidebar tone so the frame reads as
              // one material around the work area — `surface-raised` belongs to surfaces IN the
              // work area (the composer, code insets) and made this bar a mismatched dense strip.
              'relative flex h-[var(--statusbar-height)] shrink-0 items-stretch bg-sidebar',
              DROP_TARGET_TRANSITION,
              railDnd.drag.dragId && 'ring-1 ring-inset ring-foreground/10',
              railDnd.drag.overZone === 'status' && DROP_TARGET_INSET_ACTIVE,
            )}
            onDragOver={(event) => railDnd.onZoneDragOver(event, 'status')}
            onDragLeave={(event) => railDnd.onZoneDragLeave(event, 'status')}
            onDrop={(event) => railDnd.onZoneDrop(event, 'status')}
          >
            {statusEntries.length > 0 && (
              <div className="z-(--z-raised) flex shrink-0 items-stretch divide-x divide-border-soft border-t border-r border-border-soft">
                {statusEntries.map((entry, index) => (
                  <CustomizableRailButton
                    onUnpin={unpinTool}
                    key={entry.id}
                    entry={entry}
                    area="status"
                    surface="status"
                    drag={railDnd.drag}
                    isFirst={index === 0}
                    isLast={index === statusEntries.length - 1}
                    justPinned={false}
                    onDragStart={railDnd.onDragStart}
                    onDragOverItem={railDnd.onDragOverItem}
                    onDropItem={railDnd.onDropItem}
                    onDragEnd={railDnd.clearDrag}
                    onMoveWithin={railLayout.moveWithin}
                    onMoveArea={moveToArea}
                    onReset={resetRail}
                  />
                ))}
              </div>
            )}
            {footer ? (
              <div className="min-w-0 flex-1 [&>*]:h-full">{footer}</div>
            ) : (
              <div className="min-w-0 flex-1 border-t border-border-soft" aria-hidden="true" />
            )}
            {/* The answer to the person's own action when it had no control to stand beside. */}
            <TransientStatusLine />
            {/* CONTRIBUTED items, before the editor's own status: a plugin's summary belongs with
              the session's, and keeping the editor segment last means Ln/Col does not jump
              sideways as plugins come and go. */}
            <StatusItems placement="statusbar" sessionId={statusSessionId} />
            {/* Right-aligned: the focused editor's Ln/Col,
              indentation and language land here instead of in a second bar
              docked under the editor. Zero width until something contributes. */}
            <WorkbenchStatusOutlet />
          </div>
        )}

        {/* Mobile: backdrop + drawer */}
        {frame && isMobile && (
          <>
            <div
              aria-hidden="true"
              className={[
                // Same job as a dialog/drawer overlay — hide the page behind a
                // temporary surface — so it takes the same `lx-scrim` material.
                'lx-scrim fixed inset-0 z-(--z-navigation-backdrop) transition-opacity duration-(--dur-base)',
                sidebarOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
              ].join(' ')}
              onClick={onCloseSidebar}
            />
            <div
              className={[
                'fixed inset-y-0 left-0 z-(--z-sidebar) flex h-dvh w-[min(19rem,calc(100vw-2rem))] flex-row border-r border-sidebar-border bg-sidebar shadow-(--shadow-drawer) transition-transform duration-(--dur-base) ease-(--ease-soft)',
                sidebarOpen ? 'translate-x-0' : '-translate-x-full',
              ].join(' ')}
            >
              <nav
                className="h-full w-[var(--workbench-rail-width)] shrink-0 border-r border-sidebar-border"
                aria-label="Workspace navigation"
              >
                {rail}
              </nav>
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {activeSectionContent ?? sidebarContent}
              </div>
            </div>
          </>
        )}
      </div>
    </WorkbenchStatusHost>
  )
}
