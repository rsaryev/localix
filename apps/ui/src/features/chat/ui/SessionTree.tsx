import { useCallback } from 'react'
import type { UiSession } from '@/shared/api/contracts'
import { SessionItem } from './SessionItem'
import { BranchMoreRow } from './BranchMoreRow'
import { branchView } from '../model/branchDisclosure'
import { sortSessionsList, type SortMode } from '../model/useSidebarSessions'

export interface SessionTreeOptions {
  activeSessionId: string | null
  sortMode: SortMode
  normalizedSearch: string
  matchesDeep: (session: UiSession) => boolean
  forksByParent: Map<string, UiSession[]>
  threadsByParent: Map<string, UiSession[]>
  workersByParent: Map<string, UiSession[]>
  /**
   * Per-parent disclosure, stored as COLLAPSED so absent means open.
   *
   * The list used to default to a flat roster of root chats, which meant a chat's forks and
   * workers existed but were invisible until someone found the chevron. Every branch of this
   * list now answers to one rule (`branchDisclosure`): open, five children, then ask.
   */
  collapsedParents: Record<string, boolean>
  /** Which parents the user asked to see past the preview of five. */
  expandedBranches: Record<string, boolean>
  onSelectSession: (
    session: UiSession,
    event?: React.MouseEvent | React.KeyboardEvent,
  ) => void | Promise<void>
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
  toggleParent: (id: string) => void
  /** Reveal (or re-hide) the children a branch's preview is holding back. */
  toggleBranchAll: (id: string) => void
  /** Multi-select membership test — only root chats (depth 0) ever return true. */
  isSelected?: (id: string) => boolean
  /** Arrow-key roster traversal / Shift-extend over the visible root chats. */
  onArrowNav?: (session: UiSession, dir: -1 | 1, extend: boolean) => void
}

/** Returns a renderer that lays out a root chat and — only when its left chevron
 *  is open (or a search needs to reach a nested hit) — its sub-sessions as a plain
 *  recursive tree: forks, threads, and workers all appear directly as child rows
 *  (each independently disclosable if it has its own children). Collapsed by
 *  default so the sidebar stays a clean flat list until you open a row. */
export function useSessionTreeRenderer(
  opts: SessionTreeOptions,
): (rootSession: UiSession) => React.ReactNode[] {
  const {
    activeSessionId,
    sortMode,
    normalizedSearch,
    matchesDeep,
    forksByParent,
    threadsByParent,
    workersByParent,
    collapsedParents,
    expandedBranches,
    onSelectSession,
    onDelete,
    onTogglePin,
    toggleParent,
    toggleBranchAll,
    isSelected,
    onArrowNav,
  } = opts

  return useCallback(
    (rootSession: UiSession): React.ReactNode[] => {
      const rows: React.ReactNode[] = []
      const walk = (session: UiSession, depth: number) => {
        const allForks = forksByParent.get(session.id) ?? []
        const forks = normalizedSearch ? allForks.filter(matchesDeep) : allForks
        const threads = threadsByParent.get(session.id) ?? []
        const workers = workersByParent.get(session.id) ?? []
        // One uniform child list — forks, threads, and workers are just rows in the
        // tree, no aggregation nodes.
        const children = sortSessionsList([...forks, ...threads, ...workers], sortMode)
        // The same rule the agent groups answer to: open unless collapsed, five at a time,
        // and a search forces every ancestor open so a deep match stays reachable.
        const showingAll = Boolean(expandedBranches[session.id])
        const view = branchView(
          children,
          { collapsed: collapsedParents[session.id], showAll: showingAll },
          normalizedSearch !== '',
        )
        rows.push(
          <SessionItem
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onSelect={onSelectSession}
            onArrowNav={onArrowNav}
            onDelete={onDelete}
            onTogglePin={onTogglePin}
            selected={depth === 0 && (isSelected?.(session.id) ?? false)}
            depth={depth}
            childCount={children.length}
            isExpanded={view.open}
            onToggleExpand={toggleParent}
          />,
        )
        if (children.length === 0 || !view.open) return
        for (const child of view.shown) walk(child, depth + 1)
        if (view.hidden > 0 || showingAll) {
          rows.push(
            <BranchMoreRow
              key={`${session.id}:more`}
              hidden={view.hidden}
              showingAll={showingAll}
              onToggle={() => toggleBranchAll(session.id)}
              indent={8 + Math.min(depth + 1, 4) * 12}
            />,
          )
        }
      }
      walk(rootSession, 0)
      return rows
    },
    [
      forksByParent,
      threadsByParent,
      workersByParent,
      normalizedSearch,
      matchesDeep,
      collapsedParents,
      expandedBranches,
      activeSessionId,
      onSelectSession,
      onDelete,
      onTogglePin,
      toggleParent,
      toggleBranchAll,
      sortMode,
      isSelected,
      onArrowNav,
    ],
  )
}
