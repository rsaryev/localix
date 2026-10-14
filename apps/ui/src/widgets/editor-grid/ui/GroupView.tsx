import { memo, useCallback, useMemo } from 'react'
import { copyText } from '@localixai/plugin-sdk/ui/interactions'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { TabPanel, TabStrip, useTabPanelIds, type StripTabItem } from '@localixai/kit/tabs'
import { useChatStore } from '@/features/chat/model/store'
import { problemBadge } from '@/features/inspector/model/problemsCount'
import { workItemDragBus } from '@/shared/lib/workItemDragBus'
import {
  useWorkItemTransferPending,
  workItemTransferState,
} from '@/shared/lib/workItemTransferState'
import {
  finishOutsideTabDrag,
  moveTabToWorkspaceWindow,
  nativeTabTransferAvailable,
} from '../model/windowTransfer'
import { canTransferWorkItem } from '../model/windowTransferPayload'
import { revealInTree } from '@/shared/lib/explorerBus'
import {
  useGridStore,
  isEphemeralItem,
  isScopeEmpty,
  groupViewModel,
  GLOBAL_SCOPE,
  activeWorkItemContribution,
  useWorkItemKindContributions,
  type LeafNode,
} from '@/features/workspace-grid/model'
import type { ResolvedTheme } from '@/shared/theme/useTheme'
import { EmptyState } from '@/features/chat/ui/EmptyState'
import { sessionOfScope } from '@/features/workspace-grid/model'
import type { WorkItem } from '@/features/workspace-grid/model'
import { WorkItemBody } from './registry'
import { workItemIcon } from './workItemIcon'

/** A subsystem tab's color-tag tint for its strip icon (null for any kind that declares
 *  none) — e.g. a db-console tab signals its connection's color. The kind's contribution
 *  owns the color logic; core stays subsystem-agnostic. */
function tabIconTint(item: WorkItem | undefined): string | null {
  if (!item) return null
  return activeWorkItemContribution(item.kind)?.iconTint?.(item) ?? null
}

/** The shared visual fields a tab shows in BOTH the strip and its overflow menu —
 *  one source of truth so the two can't drift (the overflow used to drop the icon
 *  color tint the strip renders). */
function tabVisual(item: WorkItem | undefined, id: string) {
  return {
    title: item?.kind === 'preview' ? 'Browser' : (item?.title ?? id),
    icon: item ? workItemIcon(item.kind, tabIconTint(item)) : undefined,
    italic: item ? isEphemeralItem(item) : false,
    dirty: item?.isDirty ?? false,
    attention: item?.attention ?? false,
  }
}
import { newTabActionFor, restartTabActionFor } from './tabActions'
import { EmptyGroup } from './EmptyGroup'
import { GroupActions } from './GroupActions'
import { TabOverflowMenu } from './TabOverflowMenu'

/** One editor group (a grid leaf): its tab strip + the active tab's body, and a
 *  drop target for split/move.
 *
 *  A MEMO BOUNDARY, and the one that matters most in the workspace: dragging a split
 *  sash writes the grid store on every mousemove, which re-renders GridView 60–120×/s
 *  with chat, terminal and editor bodies mounted underneath. `resizeAdjacentLeaves`
 *  only clones BRANCH nodes, so a leaf keeps its object identity across a resize —
 *  both props stay equal and this bails for the whole drag. (Nothing this component
 *  selects from the store is derived from the tree geometry either; the one selector
 *  that reads `root` returns a boolean.) */
export const GroupView = memo(function GroupView({
  leaf,
  resolvedTheme,
}: {
  leaf: LeafNode
  resolvedTheme: ResolvedTheme
}) {
  const items = useGridStore((s) => s.items)
  const transferring = useWorkItemTransferPending()
  const activeScope = useGridStore((s) => s.activeScope)
  const tabIds = useTabPanelIds('editor-group')
  const activeGroup = useGridStore((s) => s.activeGroup)
  const setActiveGroup = useGridStore((s) => s.setActiveGroup)
  const setActiveTab = useGridStore((s) => s.setActiveTab)
  const closeTab = useGridStore((s) => s.closeTab)
  const closeTabs = useGridStore((s) => s.closeTabs)
  const reorderTab = useGridStore((s) => s.reorderTab)
  const isFocused = activeGroup === leaf.id
  // Keep-alive bookkeeping drives both visibility and which session/global
  // background bodies stay warm (mounted-but-hidden for instant switch-back).
  const warmScopes = useGridStore((s) => s.warmScopes)
  const scopeActiveTab = useGridStore((s) => s.scopeActiveTab)

  // The pure per-session view model: visible tabs (this scope + GLOBAL), the active
  // one to show, and the bodies to mount (visible + warm hidden).
  const { visibleTabs, visibleActive, mountIds } = groupViewModel(
    leaf,
    items,
    activeScope,
    warmScopes,
    scopeActiveTab,
  )
  // Strip icons and tints come from each tab kind's registration, read during render: subscribe
  // to exactly these kinds, or a plugin that registers after first paint keeps a generic icon.
  useWorkItemKindContributions(visibleTabs.flatMap((id) => (items[id] ? [items[id].kind] : [])))

  // The chat greeting is the LANDING for a truly empty workspace; a secondary
  // empty group (split / cleared while others hold tabs) gets a neutral
  // placeholder so it never reads as a duplicate chat home screen. Emptiness is
  // judged on what's VISIBLE in this scope, not hidden tabs of other sessions.
  const workspaceEmpty = useGridStore((s) => isScopeEmpty(s.root, s.items, s.activeScope))
  // Closing the active session's chat is an explicit layout action. Keep its session
  // active but leave the editor group empty — never silently replace it with a new chat.
  const sessionChatClosed = activeScope !== GLOBAL_SCOPE && !items[`chat:${activeScope}`]
  // A chat tab closes like every other workspace tab. The session is preserved in history and
  // can be deliberately reopened later; close must not create or navigate to a fresh chat.
  const closeOne = useCallback(
    (id: string) => {
      if (workItemTransferState.pending(id)) return
      closeTab(leaf.id, id)
    },
    [closeTab, leaf.id],
  )

  // Close-many over the VISIBLE tabs only: bulk closes never touch another
  // session's hidden tabs (those are freed when that session itself closes). One
  // batch reducer call (not N closeTab set()s) → a single re-render + persist.
  const closeMany = useCallback(
    (ids: string[]) =>
      closeTabs(
        leaf.id,
        ids.filter((id) => !workItemTransferState.pending(id)),
      ),
    [closeTabs, leaf.id],
  )

  // The Problems tab's open-file diagnostics → its count badge. The
  // count is of the chat the TAB belongs to (its scope), the same chat its panel lists — read off
  // the focused chat, a Problems tab kept warm for another chat would badge that chat's errors.
  // Selects a stable ref (no fresh array in the selector → no #185 render loop).
  const problemsTabId = visibleTabs.find((id) => items[id]?.kind === 'problems')
  const problemsSession = problemsTabId ? sessionOfScope(items[problemsTabId]?.scope) : null
  const diagnosticsByFile = useChatStore((s) =>
    problemsSession
      ? s.allSessions.find((x) => x.id === problemsSession)?.lspDiagnostics
      : undefined,
  )
  const problems = useMemo(() => problemBadge(diagnosticsByFile), [diagnosticsByFile])

  const tabItems: StripTabItem[] = visibleTabs.map((id) => {
    const item = items[id]
    const multiple = visibleTabs.length > 1
    const newTab = newTabActionFor(item)
    const restart = restartTabActionFor(item)
    const visual = tabVisual(item, id)
    // File/diff tabs carry an on-disk path → offer path/reveal actions.
    const filePath =
      (item?.kind === 'file' || item?.kind === 'diff') && typeof item.payload?.path === 'string'
        ? (item.payload.path as string)
        : null
    return {
      id,
      label: visual.title,
      ...tabIds.item(id),
      icon: visual.icon,
      italic: visual.italic,
      dirty: visual.dirty,
      attention: visual.attention,
      disabled: transferring.has(id),
      // Problems tab shows its error+warning count at a glance (error tone if any
      // error, else warn tone); hidden when the file set is clean.
      ...(item?.kind === 'problems' && problems
        ? { badge: problems.count, badgeTone: problems.tone }
        : {}),
      onClose: () => closeOne(id),
      onAuxClose: () => closeOne(id),
      menu: [
        // Per-kind "open another" (e.g. New Terminal) — first so it's the primary
        // affordance; absent for kinds with no in-grid creation.
        ...(newTab ? [{ label: newTab.label, onSelect: () => newTab.run() }] : []),
        ...(restart
          ? [
              {
                label: restart.label,
                disabled: !!item?.payload?.terminalRestarting,
                onSelect: restart.run,
              },
            ]
          : []),
        { label: 'Close', separatorBefore: !!newTab, onSelect: () => closeOne(id) },
        {
          label: 'Close Others',
          disabled: !multiple,
          onSelect: () => closeMany(visibleTabs.filter((t) => t !== id)),
        },
        { label: 'Close All', onSelect: () => closeMany(visibleTabs) },
        ...(nativeTabTransferAvailable()
          ? [
              {
                label: 'Move to New Window',
                separatorBefore: true,
                disabled: !canTransferWorkItem(item) || transferring.has(id),
                onSelect: () => {
                  void moveTabToWorkspaceWindow(id, 'window')
                },
              },
              {
                label: 'Move to New Workspace Tab',
                disabled: !canTransferWorkItem(item) || transferring.has(id),
                onSelect: () => {
                  void moveTabToWorkspaceWindow(id, 'tab')
                },
              },
            ]
          : []),
        // Path / location actions for file & diff tabs. "Reveal
        // in Tree" focuses this tab so the Explorer's auto-reveal locks onto it,
        // then asks the sidebar to open Files + scroll/select the path.
        ...(filePath
          ? [
              {
                label: 'Reveal in Tree',
                separatorBefore: true,
                onSelect: () => {
                  setActiveTab(leaf.id, id)
                  revealInTree(filePath)
                },
              },
              { label: 'Copy Path', onSelect: () => void copyText(filePath, 'Path') },
            ]
          : []),
      ],
    }
  })

  const onDragStateChange = useCallback(
    (dragging: boolean, id?: string) => {
      if (dragging && id) workItemDragBus.start({ itemId: id, fromGroup: leaf.id })
      else workItemDragBus.end()
    },
    [leaf.id],
  )

  const activeItem = visibleActive ? items[visibleActive] : undefined

  return (
    <section
      role="group"
      aria-label={activeItem ? `Editor group: ${activeItem.title}` : 'Editor group'}
      aria-current={isFocused || undefined}
      data-focus-part="editor"
      data-focus-active={isFocused || undefined}
      onMouseDownCapture={() => {
        if (!isFocused) setActiveGroup(leaf.id)
      }}
      // No ground coat: GridView is the work area's outermost painter and this group is nested
      // inside it. Under the macOS glass theme `--background` carries alpha, so a second coat here
      // compounded — and with splits the most deeply nested group came out the most opaque. On the
      // opaque themes the grid's coat is the identical color, so inheriting it changes nothing.
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
        isFocused && 'ring-1 ring-inset ring-border/60',
      )}
    >
      {/* Unfocused group: dim tab text (via
          activeTabClassName/inactiveTabClassName) so the group keyboard input /
          Cmd-W hits is obvious with 2+ groups. The active tab keeps its
          bg-surface-active fill; hover states stay bright. */}
      {tabItems.length > 0 && (
        <div className="relative shrink-0">
          <TabStrip
            items={tabItems}
            activeId={visibleActive}
            onChange={(id) => setActiveTab(leaf.id, id)}
            onReorder={(from, to) => reorderTab(leaf.id, from, to)}
            onDragStateChange={onDragStateChange}
            onItemDragEnd={(id, event, cancelled) => {
              void finishOutsideTabDrag(id, event, cancelled)
            }}
            variant="subtle"
            edgeFade
            aria-label="Group tabs"
            actionsLabel="Panel actions"
            actions={<GroupActions groupId={leaf.id} />}
            className="h-[var(--editor-tab-height)] shrink-0 border-b border-border-soft"
            tabClassName="max-w-44"
            activeTabClassName={isFocused ? undefined : 'text-text-soft'}
            inactiveTabClassName={isFocused ? undefined : 'text-text-faint'}
            renderOverflow={() => (
              <TabOverflowMenu
                tabs={visibleTabs.map((id) => ({ id, ...tabVisual(items[id], id) }))}
                activeId={visibleActive}
                onSelect={(id) => setActiveTab(leaf.id, id)}
              />
            )}
          />
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {mountIds.length > 0 ? (
          mountIds.map((id) => (
            // Each body keeps a stable key, so a warm background body survives the
            // session switch (just hidden) instead of remounting. Hidden bodies are
            // display:none — DOM + state (scroll/cursor, iframe, xterm) preserved.
            // `data-work-item-*` is the stable address of a body in the DOM (the panel id carries a
            // React `useId` prefix): the host drives a plugin's view through it for the agent.
            <TabPanel
              key={id}
              id={tabIds.panelId(id)}
              aria-labelledby={tabIds.tabId(id)}
              active={id === visibleActive}
              inert={transferring.has(id)}
              data-work-item-id={id}
              data-work-item-kind={items[id]?.kind}
              className="absolute inset-0 flex flex-col"
            >
              <WorkItemBody
                item={items[id]}
                visible={id === visibleActive}
                focused={isFocused && id === visibleActive}
                resolvedTheme={resolvedTheme}
              />
            </TabPanel>
          ))
        ) : !sessionChatClosed && workspaceEmpty ? (
          // The empty workspace belongs to no chat: its greeting must not route anything to the
          // chat on screen.
          <EmptyState />
        ) : (
          <EmptyGroup />
        )}
      </div>
    </section>
  )
})
