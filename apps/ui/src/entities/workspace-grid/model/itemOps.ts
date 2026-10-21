// Pure reducers over the editor-grid state. Opening, closing and shared tree updates live
// in adjacent modules; this module preserves the reducer entry points used by the store.
import type { WorkItem } from '@/shared/lib/workItem'
import type { EditorState } from './editor-state'
import { groupOfTab, patchLeaf, gcItems, bumpMru } from './grid-state'

export type { EditorState, OpenOptions } from './editor-state'
export { MAX_FILE_TABS } from './tab-open-policy'
export { openItemState } from './open-item'
export { closeTabState, reopenClosedTabState, closeTabsState, closeScopeState } from './close-items'
export { groupOfTab } from './grid-state'
import {
  type GridNode,
  type GroupRole,
  type LeafNode,
  type SplitDir,
  findLeaf,
  findLeafByRole,
  leaves,
  mapLeaves,
  makeLeaf,
  insertSplit,
  removeLeaf,
} from './tree'
import { roleForKind, resolveOpenTarget, existingLegacyGroup } from './placement'
import { recordTabHistory } from './tab-history'

export { MAX_CLOSED, MAX_TAB_HISTORY, type ClosedTab } from './tab-history'

/** Move tab `id` into `toGroup` at `index` (default: end). Cleans an emptied source. */
export function moveTabState(
  state: EditorState,
  id: string,
  toGroup: string,
  index?: number,
): EditorState {
  const source = groupOfTab(state.root, id)
  const target = findLeaf(state.root, toGroup)
  if (!source || !target) return state

  if (source.id === toGroup) {
    // Same group → reorder to index.
    const without = source.tabs.filter((t) => t !== id)
    const at = index == null ? without.length : Math.max(0, Math.min(index, without.length))
    const tabs = [...without.slice(0, at), id, ...without.slice(at)]
    // No-op reorder (e.g. a center-drop of a tab already at that position) — return
    // the same ref so subscribers don't churn and persistence isn't rewritten.
    if (tabs.length === source.tabs.length && tabs.every((t, i) => t === source.tabs[i]))
      return state
    const root = patchLeaf(state.root, source.id, (l) => ({ ...l, tabs }))
    return { ...state, root }
  }

  // Remove from source.
  const srcTabs = source.tabs.filter((t) => t !== id)
  let root: GridNode
  if (srcTabs.length === 0) {
    const removed = removeLeaf(state.root, source.id)
    root = removed.root
  } else {
    const srcActive =
      source.activeTab === id
        ? srcTabs[Math.min(source.tabs.indexOf(id), srcTabs.length - 1)]
        : source.activeTab
    root = patchLeaf(state.root, source.id, (l) => ({ ...l, tabs: srcTabs, activeTab: srcActive }))
  }
  // Insert into target (which still exists — moving never empties the target).
  root = patchLeaf(root, toGroup, (l) => {
    const at = index == null ? l.tabs.length : Math.max(0, Math.min(index, l.tabs.length))
    const tabs = [...l.tabs.slice(0, at), id, ...l.tabs.slice(at)]
    return { ...l, tabs, activeTab: id }
  })
  // Moving into a different group while another is maximized would hide the moved
  // tab — un-maximize so it stays visible.
  const maximizedGroup =
    state.maximizedGroup && state.maximizedGroup !== toGroup ? null : state.maximizedGroup
  return {
    ...state,
    root,
    items: gcItems(state, root),
    activeGroup: toGroup,
    mru: bumpMru(state.mru, toGroup),
    maximizedGroup,
  }
}

/**
 * Split `group` in `dir`, creating a new group (id `newGroupId`). If `itemId` is
 * given, that tab MOVES into the new group; otherwise the new group starts empty.
 */
export function splitState(
  state: EditorState,
  group: string,
  dir: SplitDir,
  newGroupId: string,
  itemId?: string,
  sizes?: [number, number],
): EditorState {
  const leaf = findLeaf(state.root, group)
  if (!leaf) return state
  // The split group INHERITS the source's role — a split of the editor is another
  // editor, of the panel another panel — so focus-aware placement (below) can land
  // a new tab in whichever same-role group is focused, not always the first.
  const newLeaf: LeafNode = makeLeaf(
    newGroupId,
    itemId && leaf.tabs.includes(itemId) ? [itemId] : [],
    null,
    leaf.role,
  )
  let root = insertSplit(state.root, group, dir, newLeaf, sizes)
  if (itemId && leaf.tabs.includes(itemId)) {
    // Remove the moved tab from the original group.
    root = patchLeaf(root, group, (l) => {
      const tabs = l.tabs.filter((t) => t !== itemId)
      const activeTab = l.activeTab === itemId ? (tabs[tabs.length - 1] ?? null) : l.activeTab
      return { ...l, tabs, activeTab }
    })
  }
  // The split target keeps its tabs; if it emptied (moved its only tab), keep it —
  // an empty group is valid and the user just splits to fill it. A split changes
  // the layout, so clear any maximize — otherwise the new group is hidden behind it.
  return {
    ...state,
    root,
    items: gcItems(state, root),
    activeGroup: newGroupId,
    mru: bumpMru(state.mru, newGroupId),
    maximizedGroup: null,
  }
}

/**
 * Resolve the group a `kind` should open into by its placement ROLE — independent
 * of focus/MRU, so a kind always lands in the same place (no more terminal/stats
 * landing randomly left or right). Three tiers, migration-safe:
 *   1. a group already TAGGED with the role → use it;
 *   2. else ADOPT an existing untagged group whose active tab implies that role
 *      (so pre-role persisted layouts don't spawn a duplicate group) and tag it;
 *   3. else SPAWN the role group deterministically (`resolveOpenTarget`).
 * `newId` mints fresh, collision-free group ids. Returns the new state + group id.
 */
export function resolveRoleGroupState(
  state: EditorState,
  kind: WorkItem['kind'],
  newId: () => string,
): { state: EditorState; groupId: string } {
  // Legacy-layout override BEFORE the role tiers: a persisted preview COLUMN
  // (old policy) keeps hosting the preview even though the default role is now
  // `editor` — we never re-home a column the user already has.
  const legacy = existingLegacyGroup(state.root, kind)
  if (legacy) return { state, groupId: legacy }
  const role: GroupRole = roleForKind(kind)
  // Tier 0 — focus-aware: when the FOCUSED group already carries this kind's role
  // (e.g. a file opened while one of two editor groups is focused), open there so
  // the user controls which split half receives it. Deterministic (role equality),
  // not a content heuristic; only fires when the roles match.
  const active = findLeaf(state.root, state.activeGroup)
  if (active?.role === role) return { state, groupId: active.id }
  const tagged = findLeafByRole(state.root, role)
  if (tagged) return { state, groupId: tagged.id }

  const inferred = leaves(state.root).find((l) => {
    if (l.role || !l.activeTab) return false
    const item = state.items[l.activeTab]
    return !!item && roleForKind(item.kind) === role
  })
  if (inferred) {
    const root = mapLeaves(state.root, (l) => (l.id === inferred.id ? { ...l, role } : l))
    return { state: { ...state, root }, groupId: inferred.id }
  }

  const spawned = resolveOpenTarget(state.root, kind, newId)
  return { state: { ...state, root: spawned.root }, groupId: spawned.groupId }
}

/** Set the active group (focus). */
export function setActiveGroupState(state: EditorState, group: string): EditorState {
  if (!findLeaf(state.root, group)) return state
  // Already focused + MRU-front → nothing to change (avoid a churn set()).
  if (state.activeGroup === group && state.mru[0] === group) return state
  return { ...state, activeGroup: group, mru: bumpMru(state.mru, group) }
}

/** Set the active tab within a group (also focuses that group). */
export function setActiveTabState(state: EditorState, group: string, tabId: string): EditorState {
  const leaf = findLeaf(state.root, group)
  if (!leaf || !leaf.tabs.includes(tabId)) return state
  // Re-clicking the already-active tab of the already-focused group is a no-op —
  // return the same ref so the store wrapper short-circuits (no root rebuild, no
  // persist, no re-render) instead of rebuilding the tree on every tab click.
  if (leaf.activeTab === tabId && state.activeGroup === group && state.mru[0] === group)
    return state
  const root = patchLeaf(state.root, group, (l) => ({
    ...l,
    activeTab: tabId,
    tabHistory: recordTabHistory(l.tabHistory, tabId),
  }))
  return { ...state, root, activeGroup: group, mru: bumpMru(state.mru, group) }
}

/** Update a tab's display title — e.g. a dynamic-content tab (a task panel, a
 *  tool UI) naming itself once it knows what it holds, instead of every caller
 *  pre-threading a title through the open path. No-op (same ref) when the item is
 *  absent or the title is unchanged. */
export function setTabTitleState(state: EditorState, id: string, title: string): EditorState {
  const item = state.items[id]
  if (!item || item.title === title) return state
  return { ...state, items: { ...state.items, [id]: { ...item, title } } }
}

/** Flip a tab's unsaved-buffer flag (drives the tab dirty dot). Transient — never
 *  persisted (SerializedWorkItem drops it). No-op when unchanged so a keystroke
 *  that doesn't cross the clean↔dirty boundary never triggers a re-render/persist.
 *
 *  Typing also PINS a preview tab, permanently: a dirty editor is always pinned.
 *  Guarding the replace path on `isDirty` alone is not the same thing: it protects
 *  the tab only until you save, after which the file you just edited becomes a
 *  preview again and the next single click in the tree silently takes its slot. */
export function setItemDirtyState(state: EditorState, id: string, dirty: boolean): EditorState {
  const item = state.items[id]
  const pinsPreview = dirty && item?.ephemeral === true
  if (!item || (Boolean(item.isDirty) === dirty && !pinsPreview)) return state
  const next = { ...item }
  if (dirty) next.isDirty = true
  else delete next.isDirty
  if (pinsPreview) next.ephemeral = false
  return { ...state, items: { ...state.items, [id]: next } }
}

/** Flip a tab's attention flag (drives the tab activity dot — e.g. a background
 *  terminal that produced output while hidden). Transient like `isDirty`, never
 *  persisted. No-op when unchanged so the frequent per-frame terminal-output caller
 *  never triggers a redundant re-render. */
export function setItemAttention(state: EditorState, id: string, attention: boolean): EditorState {
  const item = state.items[id]
  if (!item || Boolean(item.attention) === attention) return state
  const next = { ...item }
  if (attention) next.attention = true
  else delete next.attention
  return { ...state, items: { ...state.items, [id]: next } }
}

/** Drag-reorder a tab within its group: move `fromId` before `toId` (null = end). */
export function reorderTabState(
  state: EditorState,
  group: string,
  fromId: string,
  toId: string | null,
): EditorState {
  const leaf = findLeaf(state.root, group)
  if (!leaf || fromId === toId) return state
  const from = leaf.tabs.indexOf(fromId)
  if (from < 0) return state
  const next = leaf.tabs.slice()
  next.splice(from, 1)
  if (toId === null) next.push(fromId)
  else {
    const to = next.indexOf(toId)
    if (to < 0) return state
    next.splice(to, 0, fromId)
  }
  // No-op reorder (dragged onto the slot it already occupies — drop next to self,
  // or drop-at-end while already last). Return the same ref so subscribers don't
  // churn and persistence isn't rewritten — mirrors moveTabState's same-group guard.
  if (next.every((t, i) => t === leaf.tabs[i])) return state
  const root = patchLeaf(state.root, group, (l) => ({ ...l, tabs: next }))
  return { ...state, root }
}

/** Toggle maximize for a group (null clears). */
export function maximizeState(state: EditorState, group: string | null): EditorState {
  if (group && !findLeaf(state.root, group)) return state
  return { ...state, maximizedGroup: state.maximizedGroup === group ? null : group }
}
