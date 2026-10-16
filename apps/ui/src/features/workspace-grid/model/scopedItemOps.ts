/** Tab transitions that update workspace focus and keep-alive history together. */
import {
  openItemState,
  closeTabState,
  closeTabsState,
  reopenClosedTabState,
  moveTabState,
  splitState,
  setActiveTabState,
  groupOfTab,
  closeScopeState,
  type OpenOptions,
} from './itemOps'
import { arrangePanels as arrangePanelState } from './arrangePanels'
import { findLeaf, leaves, type SplitDir } from './tree'
import { scopeOf, GLOBAL_SCOPE, type ScopeId } from './scope'
import {
  dropTabFromScopeActive,
  recordScopeActive,
  bumpWarm,
  pruneScopeActive,
  forgetScope,
} from './warm'
import type { WorkItem } from './workItem'
import type { ScopedEditorState } from './store-contracts'

export function openScopedItemState(s: ScopedEditorState, stamped: WorkItem, opts?: OpenOptions) {
  const ns = openItemState(s, stamped, opts)
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
}

export function closeScopedTabState(s: ScopedEditorState, group: string, id: string) {
  const ns = closeTabState(s, group, id, s.activeScope)
  // A closed body must not stay warm (or come back as the remembered active).
  return ns === s ? s : { ...ns, scopeActiveTab: dropTabFromScopeActive(s.scopeActiveTab, id) }
}

export function closeScopedTabsState(s: ScopedEditorState, group: string, closable: string[]) {
  const ns = closeTabsState(s, group, closable)
  if (ns === s) return s
  let map = s.scopeActiveTab
  for (const id of closable) map = dropTabFromScopeActive(map, id)
  return { ...ns, scopeActiveTab: map }
}

export function reopenScopedTabState(s: ScopedEditorState) {
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
}

export function moveScopedTabState(
  s: ScopedEditorState,
  id: string,
  toGroup: string,
  index?: number,
) {
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
}

export function setActiveScopedTabState(s: ScopedEditorState, group: string, tabId: string) {
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
}

export function arrangeScopedPanelsState(s: ScopedEditorState, newId: () => string) {
  const next = arrangePanelState(s, newId)
  let scopeActiveTab: typeof s.scopeActiveTab = {}
  for (const leaf of leaves(next.root)) {
    for (const id of leaf.tabs) {
      scopeActiveTab = recordScopeActive(scopeActiveTab, scopeOf(s.items[id]?.scope), leaf.id, id)
    }
  }
  // Replay remembered activations after fallback strip order. Hidden conversations
  // retain their most recent tab even when several old panels merge into one.
  for (const [scope, groups] of Object.entries(s.scopeActiveTab)) {
    const orderedGroups = Object.entries(groups).sort(([a], [b]) =>
      a === s.activeGroup ? 1 : b === s.activeGroup ? -1 : 0,
    )
    for (const [, history] of orderedGroups) {
      for (const id of [...history].reverse()) {
        const leaf = groupOfTab(next.root, id)
        if (leaf) scopeActiveTab = recordScopeActive(scopeActiveTab, scope, leaf.id, id)
      }
    }
  }
  return { ...next, scopeActiveTab }
}

export function splitScopedGroupState(
  s: ScopedEditorState,
  group: string,
  dir: SplitDir,
  newGroupId: string,
  itemId?: string,
  sizes?: [number, number],
) {
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
}

/** Switch visibility and bound the keep-alive history to the scopes that can still be read. */
export function activateScopeState(s: ScopedEditorState, scope: ScopeId) {
  if (s.activeScope === scope) return s
  const warmScopes = bumpWarm(s.warmScopes, scope)
  return {
    activeScope: scope,
    warmScopes,
    scopeActiveTab: pruneScopeActive(s.scopeActiveTab, [...warmScopes, scope, GLOBAL_SCOPE]),
  }
}

export function closeWorkspaceScopeState(s: ScopedEditorState, scope: ScopeId) {
  const ns = closeScopeState(s, scope)
  const forgotten = forgetScope(s.warmScopes, s.scopeActiveTab, scope)
  return { ...ns, warmScopes: forgotten.warm, scopeActiveTab: forgotten.map }
}
