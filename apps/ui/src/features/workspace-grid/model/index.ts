export { type CoreWorkItemKind, type WorkItem, type WorkItemKind } from './workItem'
export { isCoreWorkItemKind, resolveExistingWorkItemFocus } from './workItemAddressability'
export { isRestorable, activeWorkItemContribution, isEphemeralItem } from './capabilities'
export { usePluginKind, useWorkItemKindContributions } from './usePluginKind'
export {
  type GridNode,
  type LeafNode,
  type BranchNode,
  type Orientation,
  type GroupRole,
  makeLeaf,
  leaves,
  leafIds,
  findLeaf,
} from './tree'
export { groupOfTab } from './itemOps'
export {
  useGridStore,
  hydrateGrid,
  reconcileUnavailableContributedItems,
  type GridStore,
} from './store'
export { closeGridTab } from './closeTab'
export { emptyEditorState } from './persistence'
export {
  GLOBAL_SCOPE,
  scopeOf,
  sessionOfScope,
  isTabOpenedAs,
  tabIdInScope,
  workspaceScope,
} from './scope'
export {
  groupViewModel,
  scopedViewRoot,
  adjacentGroupId,
  focusedFilePath,
  focusedVisibleTabId,
} from './groupView'
export { scopeKindOf } from './capabilities'
export { roleForKind } from './placement'
export { BASE_DIMS, scaleDims, minWidthOf, minHeightOf, type GridDims } from './dims'
export { workItemToMessageBinding } from './tabMessageBinding'

export { useActiveTabRefs } from './useActiveTabRef'
