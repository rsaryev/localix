// The pure "what does this group show right now" selector — React-free so the
// per-session visibility + warm keep-alive logic is unit-testable in isolation.
// GroupView is a thin renderer over this.
import type { WorkItem } from '@/shared/lib/workItem'
import { isPathBacked } from './capabilities'
import {
  type GridNode,
  type LeafNode,
  findLeaf,
  findLeafByRole,
  firstLeaf,
  keepLeaves,
  leaves,
} from './tree'
import { type ScopeId, GLOBAL_SCOPE, scopeOf, isVisibleInScope } from './scope'
import type { ScopeActiveTab } from './warm'

/** Does this group hold at least one tab VISIBLE in `scope` (its own session +
 *  GLOBAL)? The shared "is there anything to show here" predicate behind both the
 *  adaptive view (collapse groups empty in this scope) and the empty-workspace
 *  landing — keeps the two from drifting apart. */
export function leafHasVisibleTab(
  leaf: LeafNode,
  items: Record<string, WorkItem>,
  scope: ScopeId,
): boolean {
  return leaf.tabs.some((id) => isVisibleInScope(items[id]?.scope, scope))
}

export interface GroupViewModel {
  /** Tabs shown in the strip: this scope's session tabs + GLOBAL tabs, in order. */
  visibleTabs: string[]
  /** The visible tab to render active (prefers the stored active tab, else this
   *  scope's remembered tab so it matches the warm body, else the last visible). */
  visibleActive: string | null
  /** Bodies to mount, visibleActive first then warm hidden bodies (deduped). Each
   *  has a live item. Only `visibleActive` is shown; the rest are kept warm. */
  mountIds: string[]
  /**
   * This group's OWN recently-active tabs, most-recent first, EXCLUDING `visibleActive` — the
   * ones kept mounted-but-hidden so their body state survives a tab switch.
   *
   * Exposed because "on screen" and "recently here" are different strengths of evidence for a
   * consumer ranking context (the composer's auto-link): `visibleActive` is being looked at,
   * these were, and untouched open strip tabs follow after them. Deliberately NOT `mountIds`,
   * which also carries `warmBgIds` — the remembered
   * tabs of OTHER warm sessions, mounted only to preserve state and belonging to no tab the
   * user can currently see.
   */
  warmRecentIds: string[]
}

export function groupViewModel(
  leaf: LeafNode,
  items: Record<string, WorkItem>,
  activeScope: ScopeId,
  warmScopes: ScopeId[],
  scopeActiveTab: ScopeActiveTab,
): GroupViewModel {
  const visibleTabs = leaf.tabs.filter((id) => isVisibleInScope(items[id]?.scope, activeScope))

  const scopeRecents = scopeActiveTab[activeScope]?.[leaf.id] ?? []
  const globalRecents =
    activeScope === GLOBAL_SCOPE ? [] : (scopeActiveTab[GLOBAL_SCOPE]?.[leaf.id] ?? [])
  const remembered = scopeRecents[0]
  const visibleActive = visibleTabs.includes(leaf.activeTab ?? '')
    ? leaf.activeTab
    : remembered && visibleTabs.includes(remembered)
      ? remembered
      : (visibleTabs[visibleTabs.length - 1] ?? null)

  // Recently-active tabs in BOTH visible ownership scopes stay mounted: the active
  // session and GLOBAL. This is the shared tab lifecycle contract, so switching
  // Contributed workbenches, charts, query consoles, requests, files, …
  // preserves body state instead of remounting and refetching. Each source MRU is
  // independently bounded by TAB_WARM_LIMIT.
  //
  // `visibleTabs.includes` is the single-mount guard for re-homed tabs: as soon as
  // a tab moves to another group its stale history entry in this group cannot mount
  // a second copy.
  const warmOwnIds = [...scopeRecents, ...globalRecents].filter(
    (id) => id !== visibleActive && visibleTabs.includes(id),
  )

  // Each warm session's remembered tab in THIS group stays mounted (hidden). Only
  // session-scoped bodies — global/singleton tabs already ride visibleActive and
  // must never mount twice.
  const warmBgIds = warmScopes.flatMap((sc) => {
    if (sc === activeScope || sc === GLOBAL_SCOPE) return []
    const id = scopeActiveTab[sc]?.[leaf.id]?.[0]
    if (!id || !leaf.tabs.includes(id) || scopeOf(items[id]?.scope) === GLOBAL_SCOPE) return []
    return [id]
  })

  const mountIds = [...(visibleActive ? [visibleActive] : []), ...warmOwnIds, ...warmBgIds].filter(
    (id, i, a) => a.indexOf(id) === i && !!items[id],
  )

  const warmRecentIds = warmOwnIds.filter(
    (id, i, a) => a.indexOf(id) === i && id !== visibleActive && !!items[id],
  )

  return { visibleTabs, visibleActive, mountIds, warmRecentIds }
}

/** State slice the focused-file selector needs (a GridStore satisfies it). */
export interface FocusedFileState {
  root: GridNode
  activeGroup: string
  items: Record<string, WorkItem>
  activeScope: ScopeId
  warmScopes: ScopeId[]
  scopeActiveTab: ScopeActiveTab
}

/**
 * The split tree as it should RENDER for the active scope: a group with no tab
 * VISIBLE in this session is collapsed out, so the survivors take the full area
 * instead of showing a dead "Empty group" box (or, worse, a blank group whose only
 * body is another session's warm hidden tab). A pure VIEW transform — the store's
 * real tree (the shared geometry) is untouched, so switching back to a session that
 * filled those groups restores them; the collapsed group's warm body simply
 * unmounts (a terminal reattaches to its live PTY, a file re-reads — cheap). Falls
 * back to the chat/active/first group when the scope has no content at all (a truly
 * empty workspace → the chat greeting renders there).
 */
export function scopedViewRoot(state: FocusedFileState): GridNode {
  const fallbackId = (
    findLeafByRole(state.root, 'aux') ??
    findLeaf(state.root, state.activeGroup) ??
    firstLeaf(state.root)
  ).id
  return keepLeaves(
    state.root,
    (leaf) => leafHasVisibleTab(leaf, state.items, state.activeScope),
    fallbackId,
  )
}

/** The next/previous editor group to focus ("Focus Next/Previous Editor
 *  Group"). Cycles over the groups actually VISIBLE in the active scope — the same
 *  adaptive tree the grid renders — so a keyboard focus-move never lands on a group
 *  collapsed out of view. Returns null when there's nowhere to go (0–1 groups). If
 *  the focused group isn't in the visible set (it collapsed out), we still move to a
 *  sensible edge so the key does something rather than nothing. */
export function adjacentGroupId(state: FocusedFileState, dir: 1 | -1): string | null {
  const ids = leaves(scopedViewRoot(state)).map((l) => l.id)
  if (ids.length < 2) return null
  const i = ids.indexOf(state.activeGroup)
  const from = i < 0 ? (dir === 1 ? -1 : 0) : i
  return ids[(from + dir + ids.length) % ids.length]
}

/** The id of the FOCUSED group's tab that's actually VISIBLE in the active scope —
 *  the scope-correct replacement for raw `leaf.activeTab`, which after a session
 *  switch can still point at a now-hidden cross-scope (or warm) tab. */
export function focusedVisibleTabId(state: FocusedFileState): string | null {
  const leaf = findLeaf(state.root, state.activeGroup)
  if (!leaf) return null
  return groupViewModel(
    leaf,
    state.items,
    state.activeScope,
    state.warmScopes,
    state.scopeActiveTab,
  ).visibleActive
}

/** Path of the file/diff shown in the FOCUSED group, resolved through the SCOPE
 *  filter (never a background session's file). Used for the file-tree active-row
 *  highlight. */
export function focusedFilePath(state: FocusedFileState): string | null {
  const id = focusedVisibleTabId(state)
  const item = id ? state.items[id] : undefined
  if (item && isPathBacked(item.kind)) return (item.payload?.path as string | undefined) ?? null
  return null
}

/** State slice `openFilePaths` needs — the split tree + item registry. A GridStore
 *  (and `FocusedFileState`) satisfies it. */
export interface OpenFilesState {
  root: GridNode
  items: Record<string, WorkItem>
}

/**
 * Absolute paths of every OPEN file tab (`kind: 'file'`) whose scope is VISIBLE in
 * `scope` — the files the user currently has open in this session. Deduped, in
 * grid tab order (group by group). Scope-filtered exactly like `focusedFilePath`
 * so a background session's open files never leak into another session's context.
 * A file tab without a resolved `payload.path` is skipped. Powers the inline-
 * completion open-editors context (read by `useFileLsp`).
 */
export function openFilePaths(state: OpenFilesState, scope: ScopeId): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const leaf of leaves(state.root)) {
    for (const id of leaf.tabs) {
      const item = state.items[id]
      if (item?.kind !== 'file') continue
      if (!isVisibleInScope(item.scope, scope)) continue
      const path = item.payload?.path as string | undefined
      if (!path || seen.has(path)) continue
      seen.add(path)
      paths.push(path)
    }
  }
  return paths
}
