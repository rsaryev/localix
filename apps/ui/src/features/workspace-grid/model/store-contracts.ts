import type { EditorState, OpenOptions } from './itemOps'
import type { WorkItem } from './workItem'
import type { SplitDir } from './tree'
import type { ScopeId } from './scope'
import type { ScopeActiveTab } from './warm'

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
  /** Restore default panel placement while retaining every open tab. */
  arrangePanels: () => void
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

/** Data required by scope-aware tab transitions, independently of Zustand actions. */
export type ScopedEditorState = EditorState &
  Pick<GridStore, 'activeScope' | 'warmScopes' | 'scopeActiveTab'>
