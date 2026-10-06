import { useState, useCallback, useMemo, useRef, lazy, Suspense } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { UiSession } from '@/shared/api/contracts'
import { canJoinConversation } from '@localixai/api/agent-policy'
import { useChatStore } from '../model/store'
import { useSessionRoster } from '../model/useSessionRoster'
import type { ConversationStartStrategy } from '../model/conversationStartStrategy'
import { useSidebarNewChat } from '../model/useSidebarNewChat'
import { ChatSidebarHeader, HistorySearchField } from './ChatSidebarHeader'
import { SessionRoster } from './SessionRoster'
import { useAgents } from '@/features/settings/model/useAgents'
import { useSidebarSessions, type SortMode } from '../model/useSidebarSessions'
import { useSidebarDisclosure } from '../model/useSidebarDisclosure'
import { useSessionSelection, stepId } from '../model/useSessionSelection'
import { useSessionBatchActions } from '../model/useSessionBatchActions'
import { SessionBatchBar } from './SessionBatchBar'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { sessionTitle } from './sessionTitle'
import { useHistorySearch } from '../model/useHistorySearch'
import { HistorySearchResults } from './HistorySearchResults'
import { useMessageSearchStore } from '@/shared/lib/messageSearchBus'
import { useSessionTreeRenderer } from './SessionTree'
import { useAddProjectFolder } from '../model/useAddProjectFolder'
import { useTabPanelIds } from '@localixai/kit/tabs'
import { DataSourceTabs } from '@/shared/ui/DataSourceTabs'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { isPrimaryModifier } from '@/shared/lib/keybindings'
import { useLatestRef } from '@/shared/lib/useLatestRef'
import { DEFAULT_SESSION_GROUPING_MODE, type SessionGroupingMode } from '../model/sessionGrouping'

const ExternalHistorySidebar = lazy(
  () => import('@/features/external-agents/ui/ExternalHistorySidebar'),
)

interface ChatSidebarProps {
  activeSessionId: string | null
  onSelect: (id: string, opts?: { project?: string }) => void | Promise<void>
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
  /** Opens the workspace (project-scope) switcher. */
  onOpenScopeSwitcher: () => void
  /** The page-owned creation pipeline shared by rail, shortcuts, breadcrumb and this sidebar. */
  onNewChat: (strategy: ConversationStartStrategy) => void
}

export function ChatSidebar({
  activeSessionId,
  onSelect,
  onDelete,
  onTogglePin,
  onOpenScopeSwitcher,
  onNewChat,
}: ChatSidebarProps) {
  // The roster, not the conversations: a streamed token does not re-walk the sidebar's tree.
  const allSessions = useSessionRoster()
  const {
    projects,
    activeProjectId,
    togglePinSession,
    toggleArchiveSession,
    toggleUnreadSession,
    moveSessionToProject,
  } = useChatStore(
    useShallow((state) => ({
      projects: state.projects,
      activeProjectId: state.activeProjectId,
      togglePinSession: state.togglePinSession,
      toggleArchiveSession: state.toggleArchiveSession,
      toggleUnreadSession: state.toggleUnreadSession,
      moveSessionToProject: state.moveSessionToProject,
    })),
  )
  const handleOpenProject = useAddProjectFolder()
  const [historySource, setHistorySource] = useState<'localix' | 'external'>('localix')
  const [agentsVisited, setAgentsVisited] = useState(false)
  const historyIds = useTabPanelIds('session-history')
  const [localSearch, setLocalSearch] = useState('')
  const [agentSearch, setAgentSearch] = useState('')
  const search = historySource === 'localix' ? localSearch : agentSearch
  const setSearch = historySource === 'localix' ? setLocalSearch : setAgentSearch
  // Search stays hidden until requested; an active query keeps it open.
  const [searchOpen, setSearchOpen] = useState(false)
  const searchVisible = searchOpen || search.length > 0

  const closeSearch = useCallback(() => {
    setSearch('')
    setSearchOpen(false)
  }, [setSearch])
  const [sortMode, setSortMode] = useState<SortMode>('recent')
  const [groupingMode, setGroupingMode] = useState<SessionGroupingMode>(
    DEFAULT_SESSION_GROUPING_MODE,
  )
  const [showArchived, setShowArchived] = useState(false)
  const { collapsedParents, expandedBranches, toggleParent, toggleBranchAll, revealPath } =
    useSidebarDisclosure()

  const {
    forksByParent,
    threadsByParent,
    workersByParent,
    matchesDeep,
    normalizedSearch,
    scopeSessions,
    hasResults,
  } = useSidebarSessions({
    allSessions,
    activeProjectId,
    search: localSearch,
    sortMode,
    showArchived,
  })

  const scopeName = useMemo(
    () => projects.find((p) => p.id === activeProjectId)?.name ?? null,
    [projects, activeProjectId],
  )

  const archivedCount = useMemo(
    () =>
      allSessions.filter(
        (s) => s.isArchived && !s.parentSessionId && (s.projectId ?? null) === activeProjectId,
      ).length,
    [allSessions, activeProjectId],
  )

  // --- Multi-select roster ---------------------------------------------------
  const selection = useSessionSelection()
  const rosterRef = useRef<HTMLDivElement>(null)

  // The root chats actually laid out, in visual order. This IS the flat roster the
  // shift-range spans over and the batch actions apply to.
  //
  // No slice any more: pagination belongs to the GROUP now, because one cap over the whole
  // list would truncate before the chats were split by agent — the fortieth chat of a busy
  // agent would hide the only chat of a quiet one.
  const visibleSessions = scopeSessions
  const orderedRootIds = useMemo(() => visibleSessions.map((s) => s.id), [visibleSessions])

  // The selected root chats, filtered to sessions that still exist (a deleted or
  // vanished id simply drops out — no stale-set bookkeeping needed).
  const selectedSessions = useMemo(
    () => allSessions.filter((s) => selection.selected.has(s.id)),
    [allSessions, selection.selected],
  )

  const [pendingBatchDelete, setPendingBatchDelete] = useState(false)
  /**
   * The single row's delete confirmation, held by id.
   *
   * It used to have none: selecting several chats and deleting them asked (`pendingBatchDelete`
   * below), while "Delete conversation" on ONE row's context menu went straight through to
   * `deleteSession`. Same permanence, same lost messages — the batch path just happened to be the
   * one that got the dialog. The id is enough to re-read the title on every render, so a rename
   * landing while the question is open cannot leave stale copy on screen.
   */
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const pendingSession = useMemo(
    () => allSessions.find((session) => session.id === pendingDelete) ?? null,
    [allSessions, pendingDelete],
  )

  const batch = useSessionBatchActions({
    selected: selectedSessions,
    clear: selection.clear,
    toggleArchiveSession,
    togglePinSession,
    toggleUnreadSession,
    moveSessionToProject,
    onDelete,
  })
  const runBatchDelete = useCallback(() => {
    batch.remove()
    setPendingBatchDelete(false)
  }, [batch])

  // Cross-conversation message search (server FTS5) — this is the GLOBAL,
  // cross-scope discovery path: it surfaces chats in ANY scope the scope-local
  // title filter can't, in a separate "Found in messages" section.
  const { hits: historyHits, loading: historyLoading } = useHistorySearch(
    historySource === 'localix' ? search : '',
  )
  const sessionsById = useMemo(() => new Map(allSessions.map((s) => [s.id, s])), [allSessions])

  // Stable identity so the memoized SessionItem isn't invalidated every render.
  //
  // `useCallback` over these deps was not stable: `orderedRootIds` is re-derived from
  // `allSessions` and `selection` is a fresh object, and a streaming run replaces a session (so
  // `allSessions`) on every frame. Every row's `onSelect`/`onArrowNav` then changed on every
  // commit — measured at 44 commits/s re-rendering all ~112 visible rows with their context and
  // dropdown menus (200k Radix menu renders in a 9s turn), the largest UI cost of a run. The
  // handlers run on a click or a key, after effects, so they read the latest deps at call time.
  const rosterDeps = useLatestRef({ onSelect, onTogglePin, orderedRootIds, selection })
  // The page passes an inline arrow, so it too is read at call time.
  const handleTogglePin = useCallback(
    (id: string) => rosterDeps.current.onTogglePin(id),
    [rosterDeps],
  )
  const handleSelectSession = useCallback(
    async (session: UiSession, event?: React.MouseEvent | React.KeyboardEvent) => {
      const { onSelect, orderedRootIds, selection } = rosterDeps.current
      // A ⌘/Ctrl or Shift click on a root chat is a multi-select gesture, not a
      // navigation — toggle/range it into the batch and stay put.
      const isSelectableRoot = orderedRootIds.includes(session.id)
      if (event && isSelectableRoot && (isPrimaryModifier(event) || event.shiftKey)) {
        event.preventDefault()
        selection.select(
          session.id,
          { toggle: isPrimaryModifier(event), range: event.shiftKey },
          orderedRootIds,
        )
        return
      }
      // A plain click clears any active batch, then navigates. ALWAYS carry the
      // session's OWN scope in the URL — never infer it from the current URL/store
      // (that leaked: an active project + a same-scope click fell back to the stale
      // URL scope and bounced to Global). The URL is the single source of truth, so
      // opening any chat always lands in that chat's project.
      selection.clear()
      await onSelect(session.id, { project: session.projectId })
    },
    [rosterDeps],
  )

  // Keyboard roster traversal. Plain ↑/↓ moves focus between root chats; Shift+↑/↓
  // grows the multi-select span from the anchor (seeding it on the current row when
  // no batch is active yet). Mirrors the Shift-click gesture without a mouse.
  const handleArrowNav = useCallback(
    (session: UiSession, dir: -1 | 1, extend: boolean) => {
      const { orderedRootIds, selection } = rosterDeps.current
      const nextId = stepId(orderedRootIds, session.id, dir)
      if (!nextId) return
      if (extend) {
        if (!selection.isSelectionActive) selection.select(session.id, {}, orderedRootIds)
        selection.select(nextId, { range: true }, orderedRootIds)
      }
      // Move DOM focus to the neighbour row so the next arrow keeps stepping.
      requestAnimationFrame(() => {
        const el = rosterRef.current?.querySelector<HTMLElement>(
          `[data-session-row="${CSS.escape(nextId)}"]`,
        )
        el?.focus()
      })
    },
    [rosterDeps],
  )

  // Opening a "Found in messages" hit also seeds the chat's in-find with the same
  // query (skip when it's already the active chat — nothing to switch into).
  const handleSelectHistoryHit = useCallback(
    (session: UiSession) => {
      if (session.id !== activeSessionId) {
        useMessageSearchStore.getState().requestSearch(session.id, search.trim())
      }
      void handleSelectSession(session)
    },
    [activeSessionId, search, handleSelectSession],
  )

  // Who a chat can be with, in registry order. Read from the capability document the
  // workbench already holds for this scope, so the roster costs no request of its own.
  const { agents } = useAgents(activeProjectId ?? '')
  const chatRoster = useMemo(
    () => agents.filter(canJoinConversation).map((a) => a.record.handle),
    [agents],
  )
  const handleNewChat = useSidebarNewChat(activeProjectId, agents, onNewChat)

  const emptyPane = Boolean(search) || groupingMode !== 'agent' || chatRoster.length === 0

  const renderSessionTree = useSessionTreeRenderer({
    activeSessionId,
    sortMode,
    normalizedSearch,
    matchesDeep,
    forksByParent,
    threadsByParent,
    workersByParent,
    collapsedParents,
    expandedBranches,
    onSelectSession: handleSelectSession,
    onDelete: setPendingDelete,
    onTogglePin: handleTogglePin,
    toggleParent,
    revealPath,
    toggleBranchAll,
    isSelected: selection.isSelected,
    onArrowNav: handleArrowNav,
  })

  // No `bg-sidebar` coat: the shell's sidebar panel (WorkspaceShell) is the outermost painter of
  // that ground, and under the macOS glass theme the token carries alpha — a second coat here
  // compounds into an opaque slab. The foreground token still comes from the sidebar palette.
  return (
    <aside
      data-context-menu-boundary
      className="flex h-full w-full flex-col overflow-hidden text-sidebar-foreground"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && selection.isSelectionActive) {
          e.stopPropagation()
          selection.clear()
        }
      }}
    >
      {/* Single header row: the scope switcher IS the panel title (no redundant
          static "Chats" label), with the scope-aware actions on the right. */}
      <ChatSidebarHeader
        source={historySource}
        scopeName={scopeName}
        isGlobal={activeProjectId === null}
        onOpenScopeSwitcher={onOpenScopeSwitcher}
        onAddProjectFolder={() => {
          void handleOpenProject()
        }}
        onNewChat={() => handleNewChat()}
        searchVisible={searchVisible}
        onToggleSearch={() => (searchVisible ? closeSearch() : setSearchOpen(true))}
        viewMenu={{
          groupingMode,
          onGroupingModeChange: setGroupingMode,
          sortMode,
          onSortModeChange: setSortMode,
          showArchived,
          onShowArchivedChange: setShowArchived,
          archivedCount,
        }}
      />

      <DataSourceTabs
        value={historySource}
        ids={historyIds}
        label="Session history"
        onChange={(source) => {
          setHistorySource(source)
          if (source === 'external') setAgentsVisited(true)
          selection.clear()
        }}
      />

      <HistorySearchField
        source={historySource}
        visible={searchVisible}
        value={search}
        onChange={setSearch}
        onClose={closeSearch}
      />

      <div
        ref={rosterRef}
        role="tabpanel"
        id={historyIds.panelId('localix')}
        aria-labelledby={historyIds.tabId('localix')}
        hidden={historySource !== 'localix'}
        className={`${historySource === 'localix' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto px-2 py-2 scrollbar-thin`}
        onClick={(e) => {
          if (e.target === e.currentTarget && selection.isSelectionActive) selection.clear()
        }}
      >
        {/* The roster stands even with no chats under it: it lists who you can talk to, not
            what you have said, and hiding it left a new workspace with no way to start. It
            steps aside while SEARCHING — agents with nothing under them answer no query. */}
        {(scopeSessions.length > 0 ||
          (!search && groupingMode === 'agent' && chatRoster.length > 0)) && (
          <div className="flex flex-col gap-0.5">
            <SessionRoster
              sessions={visibleSessions}
              roster={chatRoster}
              groupingMode={groupingMode}
              renderSession={renderSessionTree}
              onNewChatWith={handleNewChat}
            />
          </div>
        )}

        {search && (
          <HistorySearchResults
            hits={historyHits}
            sessionsById={sessionsById}
            onSelect={handleSelectHistoryHit}
          />
        )}

        {search && historyLoading && historyHits.length === 0 && (
          <p className="px-3 py-3 text-2xs text-sidebar-foreground/40">Searching messages…</p>
        )}

        {/* Only when the pane would otherwise be blank — the roster above is content too. */}
        {!hasResults && emptyPane && historyHits.length === 0 && !historyLoading && (
          <div className="flex min-h-0 flex-1 select-none items-center justify-center px-4 text-center text-xs text-sidebar-foreground/40">
            {search
              ? 'No matching chats in this workspace.'
              : 'No conversations in this workspace yet.'}
          </div>
        )}
      </div>

      <div
        role="tabpanel"
        id={historyIds.panelId('external')}
        aria-labelledby={historyIds.tabId('external')}
        hidden={historySource !== 'external'}
        className={historySource === 'external' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
      >
        {agentsVisited && (
          <Suspense fallback={<LoadingHint>Reading agent history…</LoadingHint>}>
            <ExternalHistorySidebar
              owningSessionId={activeSessionId}
              search={agentSearch}
              enabled={historySource === 'external'}
            />
          </Suspense>
        )}
      </div>

      {selectedSessions.length > 0 && (
        <SessionBatchBar
          sessions={selectedSessions}
          projects={projects}
          onArchive={batch.archive}
          onPin={batch.pin}
          onMarkUnread={batch.unread}
          onMoveToProject={batch.moveToProject}
          onDelete={() => setPendingBatchDelete(true)}
          onClear={selection.clear}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingSession ? `Delete ${sessionTitle(pendingSession)}?` : 'Delete this conversation?'
        }
        description="This permanently removes the conversation and its messages. This can't be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => {
          if (pendingDelete) onDelete(pendingDelete)
          setPendingDelete(null)
        }}
        onClose={() => setPendingDelete(null)}
      />

      <ConfirmDialog
        open={pendingBatchDelete}
        title={`Delete ${selectedSessions.length} conversation${selectedSessions.length === 1 ? '' : 's'}?`}
        description="This permanently removes the selected conversations and their messages. This can't be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={runBatchDelete}
        onClose={() => setPendingBatchDelete(false)}
      />
    </aside>
  )
}
