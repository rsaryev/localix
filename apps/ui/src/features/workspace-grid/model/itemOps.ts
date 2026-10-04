// Pure reducers over the editor-grid state. Mirrors the split inspector `tabs.ts`
// used to have (pure, exhaustively unit-tested), generalized from 2 fixed docks to
// an N-group tree. The Zustand store is a thin wrapper that calls these + assigns
// fresh ids; everything testable lives here.
import type { WorkItem } from './workItem'
import { resolveTabIdentity, tabIdentityOf } from './workItem'
import {
  isCappedFileItem,
  isEphemeralCapable,
  isEphemeralItem,
  isPathBacked,
  isPinnedItem,
  isSingleton,
} from './capabilities'
import { type ScopeId, scopeOf, isVisibleInScope } from './scope'
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
import { pushMru } from '@/shared/lib/mru'

/** Max real file tabs per GROUP before the oldest non-active one is evicted. */
export const MAX_FILE_TABS = 12

/** How many user-closed tabs to remember for reopen-closed (⌘⇧T). */
export const MAX_CLOSED = 12

/** How many recent tab activations each group remembers (drives history-based
 *  activate-on-close). Bounded so a long-lived group's history can't grow forever. */
export const MAX_TAB_HISTORY = 16

/** Push `tabId` to the FRONT of a group's activation history (most-recent-first),
 *  deduping any earlier occurrence and capping the length. */
function recordTabHistory(history: string[] | undefined, tabId: string): string[] {
  const next = [tabId, ...(history ?? []).filter((t) => t !== tabId)]
  return next.length > MAX_TAB_HISTORY ? next.slice(0, MAX_TAB_HISTORY) : next
}

/** The most-recently-activated SURVIVING tab from `history` that is also VISIBLE in
 *  `activeScope` (when given) — the "return to the previously-focused
 *  tab" pick. Null when history holds no eligible survivor (caller falls back to the
 *  positional neighbour). */
function pickFromHistory(
  history: string[] | undefined,
  survivors: Set<string>,
  items: Record<string, WorkItem>,
  activeScope?: ScopeId,
): string | null {
  if (!history) return null
  for (const id of history) {
    if (!survivors.has(id)) continue
    if (activeScope && !isVisibleInScope(items[id]?.scope, activeScope)) continue
    return id
  }
  return null
}

/** A tab the user explicitly closed, remembered so it can be reopened where it
 *  was. Transient (not persisted) — cleared on reload. */
export interface ClosedTab {
  item: WorkItem
  /** The group it was closed from (reopened there if it still exists). */
  group: string
}

export interface EditorState {
  root: GridNode
  items: Record<string, WorkItem>
  activeGroup: string
  /** Group ids, most-recently-active first. */
  mru: string[]
  maximizedGroup: string | null
  /** Most-recently-closed tabs (newest last), capped at MAX_CLOSED. */
  closed: ClosedTab[]
}

/** Push closed tabs onto the reopen stack (newest last), keeping only the items
 *  worth reopening (skip ephemeral previews/live streams — they re-derive) and
 *  capping the history. */
function pushClosed(
  closed: ClosedTab[] | undefined,
  group: string,
  items: Record<string, WorkItem>,
  ids: string[],
): ClosedTab[] {
  const base = closed ?? []
  const reopenable = ids
    .map((id) => items[id])
    .filter((it): it is WorkItem => !!it && !isEphemeralItem(it))
  if (reopenable.length === 0) return base
  const next = [...base, ...reopenable.map((item) => ({ item, group }))]
  return next.length > MAX_CLOSED ? next.slice(next.length - MAX_CLOSED) : next
}

export interface OpenOptions {
  /** Target group; defaults to the active group. */
  group?: string
  /** Make the item active (steal focus). Default true. */
  activate?: boolean
  /** Open into the group's shared preview slot (agent auto-open). */
  ephemeral?: boolean
  /** Single-click preview for file-tree click-through: reuse the target
   *  group's ACTIVE tab slot (a non-dirty path-backed file/diff) instead of piling a
   *  new tab — the clicked file takes over that slot. Falls back to a normal open
   *  when the active tab is dirty, not path-backed, or absent. Ignored once an
   *  existing/twin tab for the same document is found (that reveal wins). */
  replace?: boolean
}

// ── small helpers ──────────────────────────────────────────────────────────────

/** The leaf currently holding tab `tabId`, or null. */
export function groupOfTab(root: GridNode, tabId: string): LeafNode | null {
  return leaves(root).find((l) => l.tabs.includes(tabId)) ?? null
}

/** Replace one leaf in the tree by id. */
function patchLeaf(root: GridNode, leafId: string, fn: (l: LeafNode) => LeafNode): GridNode {
  return mapLeaves(root, (l) => (l.id === leafId ? fn(l) : l))
}

/** Drop item records no longer referenced by any group. */
function gcItems(state: EditorState, root: GridNode): Record<string, WorkItem> {
  const live = new Set(leaves(root).flatMap((l) => l.tabs))
  const next: Record<string, WorkItem> = {}
  for (const [id, item] of Object.entries(state.items)) if (live.has(id)) next[id] = item
  return next
}

/** Push `group` to the front of the MRU (deduped). */
function bumpMru(mru: string[], group: string): string[] {
  return pushMru(mru, group)
}

/** Active group fallback that actually exists in the tree. */
function resolveActive(root: GridNode, preferred: string, mru: string[]): string {
  const ids = new Set(leaves(root).map((l) => l.id))
  if (ids.has(preferred)) return preferred
  const fromMru = mru.find((g) => ids.has(g))
  return fromMru ?? leaves(root)[0].id
}

/** Evict the oldest non-active capped file tab(s) in one group past the cap. */
function capFileTabs(
  items: Record<string, WorkItem>,
  tabs: string[],
  activeTab: string | null,
  keepId: string,
): string[] {
  let count = tabs.reduce((n, id) => (items[id] && isCappedFileItem(items[id]) ? n + 1 : n), 0)
  if (count <= MAX_FILE_TABS) return tabs
  const out: string[] = []
  for (const id of tabs) {
    const item = items[id]
    if (
      count > MAX_FILE_TABS &&
      item &&
      isCappedFileItem(item) &&
      id !== keepId &&
      id !== activeTab
    ) {
      count--
      continue
    }
    out.push(id)
  }
  return out
}

// ── reducers ─────────────────────────────────────────────────────────────────

/** Resolve the preview (ephemeral) flag when REVEALING an already-open tab. An
 *  explicit pin (`opts.ephemeral === false`, e.g. a file-tree double-click) pins
 *  it; otherwise the ORIGINAL rule holds — a pinned tab never reverts to a preview,
 *  else the incoming intent is taken. Never un-pins on reveal, so an agent's
 *  ephemeral re-open can't demote a user-pinned tab. */
function resolveRevealEphemeral(
  prevItem: WorkItem | undefined,
  item: WorkItem,
  opts: OpenOptions,
): boolean | undefined {
  if (opts.ephemeral === false) return false
  return isPinnedItem(prevItem) ? false : item.ephemeral
}

/**
 * Reveal an already-open tab (`existingId`) for a fresh open request: focus it and
 * adopt the reveal's targeting payload (line/column/revealAt). For an exact-id
 * re-open it keeps the incoming item verbatim (original behaviour); for a
 * tiered-identity TWIN (a different textual id addressing the same document) it
 * keeps the existing tab's id + on-disk path so the tab re-reveals without a key
 * remount. Shared by the exact-id dedup and the twin match.
 */
function revealTabState(
  state: EditorState,
  item: WorkItem,
  existingId: string,
  activate: boolean,
  opts: OpenOptions,
): EditorState {
  const leaf = groupOfTab(state.root, existingId)
  if (!leaf) return state
  const prevItem = state.items[existingId]
  const ephemeral = resolveRevealEphemeral(prevItem, item, opts)
  const merged: WorkItem =
    existingId === item.id
      ? { ...item, scope: item.scope ?? prevItem?.scope, ephemeral }
      : {
          ...(prevItem ?? item),
          id: existingId,
          title: prevItem?.title ?? item.title,
          payload: {
            ...prevItem?.payload,
            ...item.payload,
            path: prevItem?.payload?.path ?? item.payload?.path,
          },
          scope: item.scope ?? prevItem?.scope,
          ephemeral,
        }
  const items = { ...state.items, [existingId]: merged }
  if (!activate) return { ...state, items }
  const root = patchLeaf(state.root, leaf.id, (l) => ({
    ...l,
    activeTab: existingId,
    tabHistory: recordTabHistory(l.tabHistory, existingId),
  }))
  // Revealing into a different group while another is maximized would hide the
  // revealed tab — un-maximize so it's actually visible.
  const maximizedGroup =
    state.maximizedGroup && state.maximizedGroup !== leaf.id ? null : state.maximizedGroup
  return {
    ...state,
    root,
    items,
    activeGroup: leaf.id,
    mru: bumpMru(state.mru, leaf.id),
    maximizedGroup,
  }
}

/**
 * The id of an already-open tab addressing the SAME document as `item` under a
 * DIFFERENT textual id — the tiered-identity fallback to the exact-id dedup (folds
 * `/repo/./a.ts` and `/repo/a.ts` into one tab instead of stacking a duplicate).
 * Restricted to same-kind + same-scope PATH-BACKED tabs matched at the `path` tier
 * (normalized-path equality). The looser basename/title/content tiers are NOT
 * auto-folded here: two distinct path-less uploads can share a name, and merging
 * them would lose one. Null when there is no twin.
 */
function findReusableTabId(state: EditorState, item: WorkItem): string | null {
  if (!isPathBacked(item.kind)) return null
  const target = tabIdentityOf(item)
  if (!target.path) return null
  const scope = scopeOf(item.scope)
  for (const [id, candidate] of Object.entries(state.items)) {
    if (id === item.id || candidate.kind !== item.kind) continue
    if (scopeOf(candidate.scope) !== scope) continue
    if (resolveTabIdentity(tabIdentityOf(candidate), target) === 'path') return id
  }
  return null
}

/**
 * Open `item` — or reveal it if it (or a same-document twin) is already open
 * (singletons + any already-open tab). A preview open (ephemeral / `replace`)
 * reuses the target group's single preview slot; `replace` prefers the active
 * tab's slot (single-click preview) when it holds a non-dirty preview.
 */
export function openItemState(
  state: EditorState,
  item: WorkItem,
  opts: OpenOptions = {},
): EditorState {
  const activate = opts.activate ?? true

  // 1. Reveal an existing instance (dedup by id — covers singletons + re-opens).
  if (groupOfTab(state.root, item.id)) return revealTabState(state, item, item.id, activate, opts)

  // 2. Tiered-identity fallback: a DIFFERENT open id that resolves to the same
  //    document (normalized path) — reveal it rather than stacking a duplicate.
  const twinId = findReusableTabId(state, item)
  if (twinId) return revealTabState(state, item, twinId, activate, opts)

  const targetId = opts.group && findLeaf(state.root, opts.group) ? opts.group : state.activeGroup
  // A preview open rides the shared slot: an explicit ephemeral open, or a
  // `replace` (single-click preview) open. An explicit pin (ephemeral:false) is NOT
  // a preview. Singletons never preview.
  const wantPreview =
    ((opts.ephemeral ?? false) || (opts.replace ?? false)) && !isSingleton(item.kind)
  // Stamp the ephemeral pin flag only on kinds that ride the preview slot (cap-
  // driven, not a hardcoded file/diff literal set).
  const nextItem: WorkItem = isEphemeralCapable(item.kind)
    ? { ...item, ephemeral: wantPreview }
    : item

  // `replace` (file-tree click-through): reuse the target group's ACTIVE tab slot
  // when it holds a non-dirty PREVIEW file/diff — the clicked file takes over that
  // slot in place. A pinned or dirty active tab is never clobbered (falls through to
  // the ordinary preview-slot append below).
  let replaceOldId: string | undefined
  if (opts.replace) {
    const target = findLeaf(state.root, targetId)
    const activeTabId = target?.activeTab ?? undefined
    const activeItem = activeTabId ? state.items[activeTabId] : undefined
    if (
      activeItem &&
      activeTabId !== item.id &&
      isPathBacked(activeItem.kind) &&
      !activeItem.isDirty &&
      isEphemeralItem(activeItem)
    ) {
      replaceOldId = activeTabId
    }
  }

  let items = { ...state.items, [item.id]: nextItem }
  const root = patchLeaf(state.root, targetId, (leaf) => {
    let tabs = leaf.tabs
    if (replaceOldId) {
      // Swap the new tab into the replaced slot's position; drop the old id.
      const at = tabs.indexOf(replaceOldId)
      tabs = tabs.filter((id) => id !== replaceOldId)
      const insertAt = at < 0 ? tabs.length : at
      tabs = [...tabs.slice(0, insertAt), item.id, ...tabs.slice(insertAt)]
    } else {
      if (wantPreview) {
        // Replace this group's existing preview slot rather than appending — but
        // never discard a preview with UNSAVED edits (protect dirty work; it just
        // stops being the sole preview until saved/pinned).
        const drop = tabs.filter(
          (id) => items[id] && isEphemeralItem(items[id]) && !items[id].isDirty,
        )
        tabs = tabs.filter((id) => !drop.includes(id))
      }
      tabs = [...tabs, item.id]
    }
    const activeTab = activate ? item.id : (leaf.activeTab ?? item.id)
    tabs = capFileTabs(items, tabs, activeTab, item.id)
    // Record the activation so a later close can return here. Stale ids (evicted/
    // replaced tabs) stay harmless — pickFromHistory only ever returns a survivor.
    const tabHistory = activate ? recordTabHistory(leaf.tabHistory, item.id) : leaf.tabHistory
    return { ...leaf, tabs, activeTab, tabHistory }
  })
  items = gcItems({ ...state, items }, root) // drop evicted preview/replaced/capped records
  // Opening a tab into a non-maximized group while another is maximized would
  // hide it — un-maximize so the new tab is visible.
  const maximizedGroup =
    activate && state.maximizedGroup && state.maximizedGroup !== targetId
      ? null
      : state.maximizedGroup
  return {
    ...state,
    root,
    items,
    activeGroup: activate ? targetId : state.activeGroup,
    mru: activate ? bumpMru(state.mru, targetId) : state.mru,
    maximizedGroup,
  }
}

/** Pick the survivor that becomes active after closing the focused tab. Prefers a
 *  tab VISIBLE in `activeScope` (nearest to the right, else the last visible) so
 *  closing the active session's chat never promotes a hidden background-session
 *  tab — which, with the focus→URL sync gone, would otherwise just leave an
 *  invisible tab "active". Falls back to positional (right→left→first) when the
 *  scope is unknown or nothing visible survives. `idx` is the closed tab's
 *  original index; `tabs` is post-removal. */
function pickNextActiveTab(
  tabs: string[],
  idx: number,
  items: Record<string, WorkItem>,
  activeScope?: ScopeId,
): string | null {
  if (activeScope) {
    const visible = tabs.flatMap((t, i) =>
      isVisibleInScope(items[t]?.scope, activeScope) ? [{ t, i }] : [],
    )
    if (visible.length > 0)
      return (visible.find(({ i }) => i >= idx) ?? visible[visible.length - 1]).t
  }
  return tabs[idx] ?? tabs[idx - 1] ?? tabs[0] ?? null
}

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
