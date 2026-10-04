// The editor-grid store: a thin Zustand wrapper over the pure reducers in
// itemOps.ts. It owns the only impure bits — fresh group-id generation and the
// debounced persistence subscription — so the reducers stay testable.
import { create } from 'zustand'
import type { WorkItem } from './workItem'
import type { SplitDir } from './tree'
import {
  resizeBranch as resizeBranchTree,
  resizeAdjacentLeaves,
  leafIds,
  findLeaf,
  leaves,
} from './tree'
import {
  type EditorState,
  type OpenOptions,
  openItemState,
  closeTabState,
  closeTabsState,
  reopenClosedTabState,
  resolveRoleGroupState,
  moveTabState,
  splitState,
  setActiveGroupState,
  setActiveTabState,
  reorderTabState,
  maximizeState,
  closeScopeState,
  setTabTitleState,
  setItemDirtyState,
  setItemAttention,
  groupOfTab,
} from './itemOps'
import {
  type ScopeId,
  GLOBAL_SCOPE,
  resolveOpenScope,
  scopeOf,
  tabIdInScope,
  workspaceScope,
} from './scope'
import {
  type ScopeActiveTab,
  bumpWarm,
  dropTabFromScopeActive,
  pruneScopeActive,
  recordScopeActive,
  forgetScope,
} from './warm'
import { emptyEditorState, loadGrid, persistGrid } from './persistence'
import { isUnavailableContributedKind } from './capabilities'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'

/**
 * Preview-tab preference, living beside
 * the grid it governs rather than with the editor settings: it decides how a TAB
 * opens, not how a buffer renders.
 *
 * It is inlined here, not given its own module, deliberately. The store is on the
 * boot path, so a separate module becomes another startup chunk — and the UI
 * startup budget (`scripts/check-ui-startup-budget.mjs`) counts those. Its
 * siblings under `shared/ui/code-editor` stay separate precisely because nothing
 * on the boot path imports them.
 */
const PREVIEW_TABS_KEY = 'localix.editor.previewTabs'
let previewTabsEnabled = loadString(PREVIEW_TABS_KEY) !== '0' // default on
const previewTabsListeners = new Set<() => void>()

/** Whether a single-click open may ride the shared preview slot. */
export function getPreviewTabs(): boolean {
  return previewTabsEnabled
}

/** Set the preference, persist it, and notify. No-op when unchanged. */
export function setPreviewTabs(value: boolean): void {
  if (value === previewTabsEnabled) return
  previewTabsEnabled = value
  saveString(PREVIEW_TABS_KEY, value ? '1' : '0')
  for (const fn of previewTabsListeners) fn()
}

/** Subscribe to changes; returns an unsubscribe fn. */
export function subscribePreviewTabs(fn: () => void): () => void {
  previewTabsListeners.add(fn)
  return () => previewTabsListeners.delete(fn)
}

/** Strip the preview hints when preview tabs are off, so a single click opens an
 *  ordinary pinned tab and nothing is ever replaced. */
function previewOpenOptions<T extends { replace?: boolean; ephemeral?: boolean } | undefined>(
  opts: T,
): T {
  if (!opts || getPreviewTabs()) return opts
  if (opts.replace === undefined && opts.ephemeral === undefined) return opts
  const next = { ...opts }
  delete next.replace
  delete next.ephemeral
  return next
}

let groupSeq = 0
/** Fresh group id. Optionally pass the current leaf ids so the counter skips past
 *  any that are already live — the persisted tree carries `group-N` ids but the
 *  module counter resets to 0 on every page load, so without this a post-reload
 *  split would mint a `group-N` that COLLIDES with a restored group (two leaves
 *  with the same id → React key clash, the same body rendered twice, the wrong
 *  group targeted by close/move). `seedGroupSeq` handles the load-time case; this
 *  guard closes the gap for any id minted afterward. */
export function nextGroupId(existing?: Iterable<string>): string {
  const taken = existing ? new Set(existing) : null
  let id: string
  do {
    groupSeq += 1
    id = `group-${groupSeq}`
  } while (taken?.has(id))
  return id
}

/** Advance the counter past every `group-N` already present in `ids` so freshly
 *  minted ids never collide with a restored tree. Called once at store init. */
export function seedGroupSeq(ids: Iterable<string>): void {
  for (const id of ids) {
    const m = /^group-(\d+)$/.exec(id)
    if (m) groupSeq = Math.max(groupSeq, Number(m[1]))
  }
}

const ROOT_GROUP_ID = 'group-root'

export interface GridStore extends EditorState {
  openItem: (item: WorkItem, opts?: OpenOptions) => void
  closeTab: (group: string, id: string) => void
  /** Re-open a session's chat tab after the user closed it (the session stayed
   *  active, its files/git/preview still shown). Idempotent — an already-open
   *  chat is just revealed/focused. */
  reopenChat: (sessionId: string) => void
  /** Close a batch of tabs in one pass (Close Others / Close All). The caller
   *  passes the exact ids — the group collapses only if none remain. */
  closeTabs: (group: string, ids: string[]) => void
  /** Reopen the most-recently user-closed tab (⌘⇧T). */
  reopenClosedTab: () => void
  moveTab: (id: string, toGroup: string, index?: number) => void
  /** Resolve (creating/adopting if needed) the group a kind should open into by
   *  its deterministic placement role. Returns the target group id. */
  resolveRoleGroup: (kind: WorkItem['kind']) => string
  /** Split a group, optionally moving a tab into the new sibling group. */
  splitGroup: (group: string, dir: SplitDir, itemId?: string, sizes?: [number, number]) => string
  setActiveGroup: (group: string) => void
  setActiveTab: (group: string, tabId: string) => void
  reorderTab: (group: string, fromId: string, toId: string | null) => void
  /** Rename a tab in place (dynamic-content tabs naming themselves once loaded). */
  setTabTitle: (id: string, title: string) => void
  /** Set/clear a tab's unsaved-buffer dirty dot (e.g. an editor with edits). */
  setItemDirty: (id: string, dirty: boolean) => void
  /** Set/clear a tab's attention dot (e.g. a hidden terminal that emitted output). */
  setItemAttention: (id: string, attention: boolean) => void
  resizeBranch: (branchId: string, sizes: number[]) => void
  /** Repartition the two adjacent regions a resize boundary lies between, located by
   *  a leaf on each side — robust to the adaptive scope-collapsed view differing
   *  from the raw tree (a positional `resizeBranch` would silently miss). */
  resizeAdjacent: (leafA: string, leafB: string, ratioA: number) => void
  maximizeGroup: (group: string | null) => void
  resetLayout: () => void
  /** The focused session scope — only its session-scoped tabs (plus GLOBAL_SCOPE
   *  tabs) are visible. Switching it swaps the visible tab set in place. */
  activeScope: ScopeId
  setActiveScope: (scope: ScopeId) => void
  /** Free every tab of one scope (a closed/deleted session). */
  closeScope: (scope: ScopeId) => void
  /** MRU of recently-focused session scopes kept WARM (bodies mounted-but-hidden
   *  for instant switch-back); bounded by WARM_LIMIT. */
  warmScopes: ScopeId[]
  /** Last-active tab per (scope, group) — the body kept warm for a backgrounded
   *  session. GridView reads this to mount each warm scope's last tab hidden. */
  scopeActiveTab: ScopeActiveTab
}

// The store starts EMPTY and is hydrated later, by `hydrateGrid()`.
//
// Reading the persisted layout here would be a silent data-loss bug. `loadGrid` keeps
// only the kinds `isRestorable` accepts, and that answer comes from the open
// `workItemKindRegistry`, which the bundled subsystems fill in `discoverUi()`. A module's
// body runs AFTER every module it imports, so this line executes before any
// `registerUi()` has run: an unregistered kind looks non-restorable, and each reload
// quietly threw away every contributed tab while faithfully restoring the core ones.
// Hydration is therefore an
// explicit step the composition root takes once, after discovery.
const initial: EditorState = emptyEditorState(ROOT_GROUP_ID)

export const useGridStore = create<GridStore>((set) => ({
  ...initial,
  activeScope: GLOBAL_SCOPE,
  warmScopes: [],
  scopeActiveTab: {},

  // The scope is the opener's to name (`resolveOpenScope`): never the focused session. A
  // session kind opened without one is refused loudly rather than stamped with whatever chat is
  // on screen. On activation, remember the tab as its scope's warm body for that group.
  openItem: (item, opts) =>
    set((s) => {
      const scope = resolveOpenScope(item.kind, item.scope)
      if (scope === null) {
        console.error(`[grid] refused to open "${item.id}": a ${item.kind} tab names no session`)
        return s
      }
      // A plugin's session tab is one per session (`tabIdInScope`): opened from another chat it
      // becomes that chat's own tab instead of moving this one out of the chat it belongs to.
      const stamped = { ...item, scope, id: tabIdInScope(item.kind, item.id, scope) }
      // One chokepoint for the preview-tab preference: with it off, no open may take another
      // tab's slot, so every caller's `replace`/`ephemeral` hint is dropped here
      // rather than at each of the call sites that pass one.
      const ns = openItemState(s, stamped, previewOpenOptions(opts))
      if (ns === s || opts?.activate === false) return ns
      // Identity resolution may reveal an existing tab whose stable id differs
      // from the requested id. Record the body that actually became active.
      const leaf = groupOfTab(ns.root, stamped.id) ?? findLeaf(ns.root, ns.activeGroup)
      const activeId = leaf?.activeTab
      return leaf && activeId && ns.items[activeId]
        ? {
            ...ns,
            scopeActiveTab: recordScopeActive(
              s.scopeActiveTab,
              scopeOf(ns.items[activeId]?.scope),
              leaf.id,
              activeId,
            ),
          }
        : ns
    }),
  // Pass the active scope so the next-active-tab pick prefers a survivor visible
  // in this session, never a hidden background-session tab.
  closeTab: (group, id) =>
    set((s) => {
      const ns = closeTabState(s, group, id, s.activeScope)
      // A closed body must not stay warm (or come back as the remembered active).
      return ns === s ? s : { ...ns, scopeActiveTab: dropTabFromScopeActive(s.scopeActiveTab, id) }
    }),
  reopenChat: (sessionId) => {
    const s = useGridStore.getState()
    const id = `chat:${sessionId}`
    s.openItem(
      {
        kind: 'chat' as const,
        id,
        title: s.items[id]?.title ?? 'Chat',
        scope: sessionId,
        payload: { sessionId },
      },
      { group: s.resolveRoleGroup('chat') },
    )
  },
  closeTabs: (group, ids) =>
    set((s) => {
      const ns = closeTabsState(s, group, ids)
      if (ns === s) return s
      let map = s.scopeActiveTab
      for (const id of ids) map = dropTabFromScopeActive(map, id)
      return { ...ns, scopeActiveTab: map }
    }),
  reopenClosedTab: () =>
    set((s) => {
      const tabId = s.closed?.at(-1)?.item.id
      const ns = reopenClosedTabState(s)
      if (ns === s || !tabId) return ns
      const leaf = groupOfTab(ns.root, tabId)
      if (!leaf || !ns.items[tabId]) return ns
      return {
        ...ns,
        scopeActiveTab: recordScopeActive(
          dropTabFromScopeActive(s.scopeActiveTab, tabId),
          scopeOf(ns.items[tabId]?.scope),
          leaf.id,
          tabId,
        ),
      }
    }),
  moveTab: (id, toGroup, index) =>
    set((s) => {
      const before = groupOfTab(s.root, id)
      const ns = moveTabState(s, id, toGroup, index)
      if (ns === s) return s
      const after = groupOfTab(ns.root, id)
      // A same-group reorder does not activate a different body. A cross-group
      // move does, so relocate its keep-alive history atomically with the tab.
      if (!after || before?.id === after.id) return ns
      return {
        ...ns,
        scopeActiveTab: recordScopeActive(
          dropTabFromScopeActive(s.scopeActiveTab, id),
          scopeOf(ns.items[id]?.scope),
          after.id,
          id,
        ),
      }
    }),
  resolveRoleGroup: (kind) => {
    const s = useGridStore.getState()
    const r = resolveRoleGroupState(s, kind, () => nextGroupId(leafIds(s.root)))
    // Only commit when the tree actually changed (a new role group was adopted or
    // spawned). The common path — the role group already exists — returns the same
    // state, so we skip a no-op set + its persist on every session switch/reveal.
    if (r.state !== s) set(() => r.state)
    return r.groupId
  },
  splitGroup: (group, dir, itemId, sizes) => {
    const newGroupId = nextGroupId(leafIds(useGridStore.getState().root))
    set((s) => {
      const ns = splitState(s, group, dir, newGroupId, itemId, sizes)
      if (ns === s || !itemId || !ns.items[itemId]) return ns
      const leaf = groupOfTab(ns.root, itemId)
      if (!leaf || leaf.id !== newGroupId) return ns
      return {
        ...ns,
        scopeActiveTab: recordScopeActive(
          dropTabFromScopeActive(s.scopeActiveTab, itemId),
          scopeOf(ns.items[itemId]?.scope),
          newGroupId,
          itemId,
        ),
      }
    })
    return newGroupId
  },
  setActiveGroup: (group) => set((s) => setActiveGroupState(s, group)),
  setActiveTab: (group, tabId) =>
    set((s) => {
      const ns = setActiveTabState(s, group, tabId)
      if (ns === s) return s
      return {
        ...ns,
        scopeActiveTab: recordScopeActive(
          s.scopeActiveTab,
          scopeOf(s.items[tabId]?.scope),
          group,
          tabId,
        ),
      }
    }),
  reorderTab: (group, fromId, toId) => set((s) => reorderTabState(s, group, fromId, toId)),
  setTabTitle: (id, title) => set((s) => setTabTitleState(s, id, title)),
  setItemDirty: (id, dirty) => set((s) => setItemDirtyState(s, id, dirty)),
  setItemAttention: (id, attention) => set((s) => setItemAttention(s, id, attention)),
  resizeBranch: (branchId, sizes) =>
    set((s) => ({ root: resizeBranchTree(s.root, branchId, sizes) })),
  resizeAdjacent: (leafA, leafB, ratioA) =>
    set((s) => ({ root: resizeAdjacentLeaves(s.root, leafA, leafB, ratioA) })),
  maximizeGroup: (group) => set((s) => maximizeState(s, group)),
  resetLayout: () =>
    set((s) => ({
      ...emptyEditorState(ROOT_GROUP_ID),
      activeScope: s.activeScope,
      warmScopes: s.warmScopes,
      scopeActiveTab: {},
    })),
  setActiveScope: (requested) =>
    set((s) => {
      // A sub-session shows its root's workspace (`workspaceScope`), so stepping into it is no
      // scope change at all and the workbench does not move.
      const scope = workspaceScope(requested)
      if (s.activeScope === scope) return s
      const warmScopes = bumpWarm(s.warmScopes, scope)
      // Bound the remembered-tab map to the live scopes (warm + active + GLOBAL);
      // an evicted scope's entry is never read again (it remounts on return).
      return {
        activeScope: scope,
        warmScopes,
        scopeActiveTab: pruneScopeActive(s.scopeActiveTab, [...warmScopes, scope, GLOBAL_SCOPE]),
      }
    }),
  closeScope: (scope) =>
    set((s) => {
      const ns = closeScopeState(s, scope)
      const forgotten = forgetScope(s.warmScopes, s.scopeActiveTab, scope)
      return { ...ns, warmScopes: forgotten.warm, scopeActiveTab: forgotten.map }
    }),
}))

// Persist the restorable slice (debounced inside persistGrid).
useGridStore.subscribe((state) => persistGrid(state))

let hydrated = false

/**
 * Test seam: return the store to its pre-hydration state.
 *
 * `hydrated` is module state and `bun test` runs every file in one process, so a suite
 * that calls {@link hydrateGrid} decides what the NEXT test sees. Without this, the
 * hydration tests only passed in declaration order — under `--randomize` the
 * "store must still be empty" assertion met a populated store, and the once-only test
 * silently asserted nothing because hydration had already been consumed.
 */
export function __resetGridForTests(): void {
  hydrated = false
  useGridStore.setState({
    ...initial,
    activeScope: GLOBAL_SCOPE,
    warmScopes: [],
    scopeActiveTab: {},
  })
}

/**
 * Restore the persisted layout into the empty store. Call ONCE, from the composition
 * root, AFTER `discoverUi()` — the restore filter asks the work-item registry which
 * kinds survive a reload, so a kind registered later than this call is dropped.
 *
 * Idempotent, and a no-op once anything has been opened: hydrating over live tabs would
 * replace them with a stale snapshot.
 */
export function hydrateGrid(): void {
  if (hydrated) return
  hydrated = true
  if (Object.keys(useGridStore.getState().items).length > 0) return
  const restored = loadGrid()
  if (!restored) return
  // Resume the id counter past the restored tree so the first post-reload split
  // can't re-mint a group id that already exists in the persisted layout.
  seedGroupSeq(leafIds(restored.root))
  useGridStore.setState(restored)
}

/**
 * Once the backend publishes the authoritative enabled-plugin set, close only tabs whose
 * registered owner is now confirmed disabled. During the cold `pending` phase those tabs
 * remain intact so a slow sidecar can never erase a user's saved layout.
 */
export function reconcileUnavailableContributedItems(): void {
  const snapshot = useGridStore.getState()
  const targets: Array<{ group: string; ids: string[] }> = []
  for (const leaf of leaves(snapshot.root)) {
    const ids = leaf.tabs.filter((id) => {
      const item = snapshot.items[id]
      return item ? isUnavailableContributedKind(item.kind) : false
    })
    if (ids.length > 0) targets.push({ group: leaf.id, ids })
  }

  for (const target of targets) useGridStore.getState().closeTabs(target.group, target.ids)
  // `closeTabs` normally records user-closed tabs for Cmd+Shift+T. Plugin
  // deactivation is a system reconciliation, though: retaining those items
  // would let reopenClosedTab resurrect a kind whose renderer is disabled.
  useGridStore.setState((state) => {
    const closed = state.closed.filter(({ item }) => !isUnavailableContributedKind(item.kind))
    return closed.length === state.closed.length ? state : { ...state, closed }
  })
}
