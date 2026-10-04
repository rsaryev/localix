export {
  CORE_WORK_ITEM_KINDS,
  type CoreWorkItemKind,
  type WorkItem,
  type WorkItemKind,
  type SerializedWorkItem,
} from './workItem'
export {
  CORE_WORK_ITEM_ADDRESSABILITY,
  isCoreWorkItemKind,
  resolveExistingWorkItemFocus,
  workItemAddressability,
  type WorkItemFocusState,
  type WorkItemAddressability,
} from './workItemAddressability'
export {
  type WorkItemCapability,
  WORK_ITEM_CAPS,
  capsOf,
  isSingleton,
  isRestorable,
  isPendingContributedKind,
  activeWorkItemContribution,
  isEphemeralItem,
} from './capabilities'
export { usePluginKind, useWorkItemKindContributions } from './usePluginKind'
export {
  type GridNode,
  type LeafNode,
  type BranchNode,
  type Orientation,
  type SplitDir,
  type GroupRole,
  makeLeaf,
  leaves,
  leafIds,
  firstLeaf,
  findLeaf,
  findLeafByRole,
} from './tree'
export {
  type EditorState,
  type OpenOptions,
  MAX_FILE_TABS,
  groupOfTab,
  closeScopeState,
} from './itemOps'
export {
  useGridStore,
  nextGroupId,
  hydrateGrid,
  reconcileUnavailableContributedItems,
  type GridStore,
} from './store'
export { closeGridTab } from './closeTab'
export { emptyEditorState } from './persistence'
export {
  type ScopeId,
  GLOBAL_SCOPE,
  resolveOpenScope,
  scopeOf,
  sessionOfScope,
  isVisibleInScope,
  isTabOpenedAs,
  tabIdInScope,
  workspaceScope,
} from './scope'
export {
  type GroupViewModel,
  type OpenFilesState,
  groupViewModel,
  scopedViewRoot,
  adjacentGroupId,
  focusedFilePath,
  focusedVisibleTabId,
  openFilePaths,
  isScopeEmpty,
} from './groupView'
export { scopeKindOf } from './capabilities'
export { resolveOpenTarget, roleForKind } from './placement'
export {
  MIN_GROUP_W,
  MIN_GROUP_H,
  ROLE_MIN_W,
  BASE_DIMS,
  scaleDims,
  minWidthOf,
  minHeightOf,
  type GridDims,
} from './dims'
export { workItemToMessageBinding, workItemToMessageBindings } from './tabMessageBinding'
export {
  type ActiveTabLink,
  activeTabLink,
  tabLinkToken,
  tabMessageBindings,
} from './activeTabLink'
export { useActiveTabRef, useActiveTabRefs } from './useActiveTabRef'
