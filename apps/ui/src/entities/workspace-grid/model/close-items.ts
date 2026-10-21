import type { EditorState } from './editor-state'
import { type ScopeId, scopeOf } from './scope'
import { findLeaf, leaves, mapLeaves, removeLeaf } from './tree'
import { patchLeaf, gcItems, bumpMru, resolveActive } from './grid-state'
import { pickFromHistory, pushClosed, pickNextActiveTab } from './tab-history'
import { openItemState } from './open-item'

/** Close tab `id` from `group`; collapse the group if it empties (unless it's the last). */
export function closeTabState(
  state: EditorState,
  group: string,
  id: string,
  activeScope?: ScopeId,
): EditorState {
  const leaf = findLeaf(state.root, group)
  if (!leaf || !leaf.tabs.includes(id)) return state
  const idx = leaf.tabs.indexOf(id)
  const tabs = leaf.tabs.filter((t) => t !== id)

  const closed = pushClosed(state.closed, group, state.items, [id])
  if (tabs.length === 0) {
    const { root, rehomeTo } = removeLeaf(state.root, group)
    const items = gcItems(state, root)
    const activeGroup = resolveActive(root, rehomeTo ?? state.activeGroup, state.mru)
    return {
      ...state,
      root,
      items,
      closed,
      activeGroup,
      mru: bumpMru(
        state.mru.filter((g) => g !== group),
        activeGroup,
      ),
      maximizedGroup: state.maximizedGroup === group ? null : state.maximizedGroup,
    }
  }

  // Drop the closed tab from history everywhere, then (only if it WAS active) pick
  // the most-recently-focused surviving tab; fall back to the positional neighbour.
  const tabHistory = (leaf.tabHistory ?? []).filter((t) => t !== id)
  const activeTab =
    leaf.activeTab === id
      ? (pickFromHistory(tabHistory, new Set(tabs), state.items, activeScope) ??
        pickNextActiveTab(tabs, idx, state.items, activeScope))
      : leaf.activeTab
  const root = patchLeaf(state.root, group, (l) => ({ ...l, tabs, activeTab, tabHistory }))
  return { ...state, root, items: gcItems(state, root), closed }
}

/**
 * Reopen the most-recently user-closed tab (⌘⇧T). Restores it into the group it
 * was closed from when that group still exists, else the active group. Singletons
 * already reopened elsewhere are revealed (openItemState dedups by id).
 */
export function reopenClosedTabState(state: EditorState): EditorState {
  const stack = state.closed ?? []
  if (stack.length === 0) return state
  const last = stack[stack.length - 1]
  const closed = stack.slice(0, -1)
  const group = findLeaf(state.root, last.group) ? last.group : state.activeGroup
  return { ...openItemState({ ...state, closed }, last.item, { group }) }
}

/**
 * Close a SET of tabs from `group` in one pass — the batch primitive behind
 * "Close Others" / "Close All". Scope-agnostic: the caller passes exactly which
 * ids to close (the UI passes the VISIBLE ones), so a bulk close never reaches
 * another session's hidden tabs and the group collapses only when NOTHING remains
 * (a surviving hidden cross-scope tab keeps it alive). Pushes the closed tabs onto
 * the reopen stack in tab order. No-op (same ref) when no id matches.
 */
export function closeTabsState(state: EditorState, group: string, ids: string[]): EditorState {
  const leaf = findLeaf(state.root, group)
  if (!leaf) return state
  const closeSet = new Set(ids.filter((id) => leaf.tabs.includes(id)))
  if (closeSet.size === 0) return state
  const closed = pushClosed(
    state.closed,
    group,
    state.items,
    leaf.tabs.filter((id) => closeSet.has(id)),
  )
  const tabs = leaf.tabs.filter((id) => !closeSet.has(id))

  if (tabs.length === 0) {
    const { root, rehomeTo } = removeLeaf(state.root, group)
    // Last group can't be removed — removeLeaf keeps it; just clear its tabs.
    if (findLeaf(root, group)) {
      const cleared = patchLeaf(root, group, (l) => ({
        ...l,
        tabs: [],
        activeTab: null,
        tabHistory: [],
      }))
      return { ...state, root: cleared, items: gcItems(state, cleared), closed }
    }
    const activeGroup = resolveActive(root, rehomeTo ?? state.activeGroup, state.mru)
    return {
      ...state,
      root,
      items: gcItems(state, root),
      closed,
      activeGroup,
      mru: bumpMru(
        state.mru.filter((g) => g !== group),
        activeGroup,
      ),
      maximizedGroup: state.maximizedGroup === group ? null : state.maximizedGroup,
    }
  }

  // Some tabs remain (a kept "Close Others" tab, or another session's hidden tab) —
  // re-point the active tab to a survivor only if the active one was just closed:
  // history-preferred (most-recently-focused survivor), else the last remaining tab.
  const tabHistory = (leaf.tabHistory ?? []).filter((id) => !closeSet.has(id))
  const activeTab = closeSet.has(leaf.activeTab ?? '')
    ? (pickFromHistory(tabHistory, new Set(tabs), state.items) ?? tabs[tabs.length - 1] ?? null)
    : leaf.activeTab
  const root = patchLeaf(state.root, group, (l) => ({ ...l, tabs, activeTab, tabHistory }))
  return { ...state, root, items: gcItems(state, root), closed }
}

/**
 * Free an ENTIRE scope (a closed/deleted session): drop every tab + item record
 * belonging to it, then collapse any group it emptied (the last group is kept,
 * just cleared). Global tabs and other sessions' tabs are untouched. This is the
 * single "free on close" hook — `inspector.closeSession` routes here.
 */
export function closeScopeState(state: EditorState, scope: ScopeId): EditorState {
  const dropIds = new Set(
    Object.keys(state.items).filter((id) => scopeOf(state.items[id].scope) === scope),
  )
  // Forget this scope's reopen-closed entries regardless of whether it still has
  // open tabs — without this, ⌘⇧T could resurrect a tab whose session is gone
  // (reopened with a dead/orphaned scope). A scope may own NO open tabs (its last
  // one was already closed onto the stack) yet still sit in `closed`.
  const closed = state.closed.filter((c) => scopeOf(c.item.scope) !== scope)
  if (dropIds.size === 0)
    return closed.length === state.closed.length ? state : { ...state, closed }

  // Leaves wholly owned by this scope (every tab dropped) collapse; mixed leaves
  // just lose the scope's tabs and re-point activeTab to a survivor.
  const emptied = leaves(state.root).flatMap((l) =>
    l.tabs.length > 0 && l.tabs.every((id) => dropIds.has(id)) ? [l.id] : [],
  )

  let root = mapLeaves(state.root, (l) => {
    if (!l.tabs.some((id) => dropIds.has(id))) return l
    const tabs = l.tabs.filter((id) => !dropIds.has(id))
    const activeTab = tabs.includes(l.activeTab ?? '')
      ? l.activeTab
      : (tabs[tabs.length - 1] ?? null)
    return { ...l, tabs, activeTab }
  })
  for (const id of emptied) root = removeLeaf(root, id).root

  const items = gcItems(state, root)
  const activeGroup = resolveActive(root, state.activeGroup, state.mru)
  return {
    ...state,
    root,
    items,
    activeGroup,
    closed,
    mru: bumpMru(
      state.mru.filter((g) => findLeaf(root, g)),
      activeGroup,
    ),
    maximizedGroup:
      state.maximizedGroup && findLeaf(root, state.maximizedGroup) ? state.maximizedGroup : null,
  }
}
