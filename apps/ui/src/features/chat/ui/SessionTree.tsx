import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { UiSession } from '@/shared/api/contracts'
import { SessionItem } from './SessionItem'
import { BranchMoreRow } from './BranchMoreRow'
import { branchView, BRANCH_PREVIEW } from '../model/branchDisclosure'
import { sortSessionsList, type SortMode } from '../model/useSidebarSessions'
import { sidebarChildren, sidebarSessionPath } from '../model/sidebarSessionTree'

export interface SessionTreeOptions {
  activeSessionId: string | null
  sortMode: SortMode
  normalizedSearch: string
  matchesDeep: (session: UiSession) => boolean
  forksByParent: Map<string, UiSession[]>
  threadsByParent: Map<string, UiSession[]>
  workersByParent: Map<string, UiSession[]>
  /** Explicit folds override the defaults: active root open, other roots folded. */
  collapsedParents: Record<string, boolean>
  /** Which parents the user asked to see past the preview of five. */
  expandedBranches: Record<string, boolean>
  onSelectSession: (
    session: UiSession,
    event?: React.MouseEvent | React.KeyboardEvent,
  ) => void | Promise<void>
  onDelete: (id: string) => void
  onTogglePin: (id: string) => void
  toggleParent: (id: string, isExpanded: boolean) => void
  revealPath: (ids: readonly string[]) => void
  /** Reveal (or re-hide) the children a branch's preview is holding back. */
  toggleBranchAll: (id: string) => void
  /** Multi-select membership test — only root chats (depth 0) ever return true. */
  isSelected?: (id: string) => boolean
  /** Arrow-key roster traversal / Shift-extend over the visible root chats. */
  onArrowNav?: (session: UiSession, dir: -1 | 1, extend: boolean) => void
}

/** Flat row output preserves roster navigation while rendering actual parent-child branches. */
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
    revealPath,
    toggleBranchAll,
    isSelected,
    onArrowNav,
  } = opts

  const index = useMemo(
    () => ({ forksByParent, threadsByParent, workersByParent }),
    [forksByParent, threadsByParent, workersByParent],
  )
  const activePath = useMemo(
    () => sidebarSessionPath(activeSessionId, index),
    [activeSessionId, index],
  )
  const revealedPath = useRef('')
  useEffect(() => {
    const key = activePath.join('/')
    if (revealedPath.current === key) return
    revealedPath.current = key
    revealPath(activePath)
  }, [activePath, revealPath])

  return useCallback(
    (rootSession: UiSession): React.ReactNode[] => {
      const rows: React.ReactNode[] = []
      const seen = new Set<string>()
      const walk = (session: UiSession, depth: number, prefixCols: boolean[], isLast: boolean) => {
        if (seen.has(session.id)) return
        seen.add(session.id)
        const allChildren = sidebarChildren(session.id, index)
        const children = sortSessionsList(
          normalizedSearch ? allChildren.filter(matchesDeep) : allChildren,
          sortMode,
        )
        const showingAll = Boolean(expandedBranches[session.id])
        const view = branchView(
          children,
          {
            collapsed:
              collapsedParents[session.id] ?? (depth === 0 && !activePath.includes(session.id)),
            showAll: showingAll,
          },
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
            treePrefixCols={prefixCols}
            isLastChild={isLast}
            childCount={children.length}
            isExpanded={view.open}
            onToggleExpand={(id) => toggleParent(id, view.open)}
          />,
        )
        if (children.length === 0 || !view.open) return
        const childPrefix = depth === 0 ? [] : [...prefixCols, !isLast]
        view.shown.forEach((child, i) =>
          walk(child, depth + 1, childPrefix, i === view.shown.length - 1),
        )
        if (
          !normalizedSearch &&
          (view.hidden > 0 || (showingAll && children.length > BRANCH_PREVIEW))
        ) {
          rows.push(
            <BranchMoreRow
              key={`${session.id}:more`}
              hidden={view.hidden}
              showingAll={showingAll}
              onToggle={() => toggleBranchAll(session.id)}
              indent={8 + Math.min(depth + 1, 4) * 20}
            />,
          )
        }
      }
      walk(rootSession, 0, [], true)
      return rows
    },
    [
      normalizedSearch,
      matchesDeep,
      collapsedParents,
      expandedBranches,
      activeSessionId,
      onSelectSession,
      onDelete,
      onTogglePin,
      toggleParent,
      index,
      activePath,
      toggleBranchAll,
      sortMode,
      isSelected,
      onArrowNav,
    ],
  )
}
