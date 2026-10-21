import { resolveOpenTarget, roleForKind } from './placement'
import { groupOfTab, type EditorState } from './itemOps'
import { findLeaf, findLeafByRole, leaves, makeLeaf, mapLeaves } from './tree'

/** Restore the default role layout without closing tabs, buffers or other conversations. */
export function arrangePanels(state: EditorState, newId: () => string): EditorState {
  const oldGroups = leaves(state.root)
  const editorId =
    findLeafByRole(state.root, 'editor')?.id ??
    oldGroups.find((group) =>
      group.tabs.some((id) => state.items[id] && roleForKind(state.items[id].kind) === 'editor'),
    )?.id
  const auxId =
    findLeafByRole(state.root, 'aux')?.id ??
    oldGroups.find((group) => group.id !== editorId)?.id ??
    newId()
  let root = makeLeaf(auxId, [], null, 'aux') as EditorState['root']
  const focusedTab = findLeaf(state.root, state.activeGroup)?.activeTab
  for (const group of oldGroups) {
    for (const id of group.tabs) {
      const item = state.items[id]
      if (!item) continue
      const target = resolveOpenTarget(root, item.kind, () =>
        editorId && editorId !== auxId ? editorId : newId(),
      )
      root = mapLeaves(target.root, (leaf) =>
        leaf.id === target.groupId
          ? {
              ...leaf,
              tabs: [...leaf.tabs, id],
              activeTab: group.activeTab === id || !leaf.activeTab ? id : leaf.activeTab,
            }
          : leaf,
      )
    }
  }
  const activeGroup = focusedTab ? groupOfTab(root, focusedTab)?.id : null
  if (focusedTab && activeGroup) {
    root = mapLeaves(root, (leaf) =>
      leaf.id === activeGroup ? { ...leaf, activeTab: focusedTab } : leaf,
    )
  }
  root = mapLeaves(root, (leaf) => {
    const history = oldGroups
      .flatMap((group) => group.tabHistory ?? [])
      .filter((id) => leaf.tabs.includes(id))
    return {
      ...leaf,
      tabHistory: [...new Set([...(leaf.activeTab ? [leaf.activeTab] : []), ...history])],
    }
  })
  return {
    ...state,
    root,
    activeGroup: activeGroup ?? leaves(root)[0].id,
    maximizedGroup: null,
    mru: leaves(root).map((leaf) => leaf.id),
  }
}

/** The workbench has one main column and one companion column, without stacked panels. */
export function hasFixedPanelLayout(state: Pick<EditorState, 'root' | 'items'>): boolean {
  const groups = leaves(state.root)
  if (groups.length === 1 && groups[0].tabs.length === 0) return true
  if (groups.length > 2) return false
  if (
    state.root.type === 'branch' &&
    (state.root.orientation !== 'h' || state.root.children.some((child) => child.type !== 'leaf'))
  )
    return false
  const roles = new Set(groups.map((group) => group.role))
  if (roles.size !== groups.length) return false
  if (groups.length === 2 && (groups[0].role !== 'editor' || groups[1].role !== 'aux')) return false
  return groups.every(
    (group) =>
      (group.role === 'editor' || group.role === 'aux') &&
      group.tabs.every(
        (id) => !state.items[id] || roleForKind(state.items[id].kind) === group.role,
      ),
  )
}
