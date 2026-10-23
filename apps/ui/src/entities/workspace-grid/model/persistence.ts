import { workspaceStorageKey } from '@/shared/lib/workspaceWindow'
// Persistence for the editor grid: a single JSON blob carrying the group tree, the
// restorable WorkItems, and the focus state (serialized grid + per-group inputs +
// active group). Debounced save; a load
// sanitizes the tree against the items that actually survived.
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import { createPendingWrite } from '@/shared/lib/quitFlush'
import type { SerializedWorkItem, WorkItem } from '@/shared/lib/workItem'
import { isRestorableForPersistence, persistedScopeKindOf } from './capabilities'
import { GLOBAL_SCOPE } from './scope'
import type { EditorState } from './itemOps'
import { type GridNode, type LeafNode, leaves, mapLeaves, pruneEmptyLeaves, makeLeaf } from './tree'

const FALLBACK_GROUP_ID = 'group-root'

const STORAGE_KEY = workspaceStorageKey('workspace_grid_v2')

export interface PersistedGrid {
  root: GridNode
  items: SerializedWorkItem[]
  activeGroup: string
  maximizedGroup: string | null
}

/** A spawn promise belongs to this renderer; its pending flag cannot survive a reload. */
function persistedPayload(
  item: WorkItem | SerializedWorkItem,
): Record<string, unknown> | undefined {
  if (item.kind !== 'terminal' || !item.payload || !('terminalRestarting' in item.payload))
    return item.payload
  const payload = { ...item.payload }
  delete payload.terminalRestarting
  return payload
}

function toSerializedItem(item: WorkItem): SerializedWorkItem {
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    ...(item.scope ? { scope: item.scope } : {}),
    ...(item.payload ? { payload: persistedPayload(item) } : {}),
  }
}

/** Filter each leaf's tabs to surviving ids, fix activeTab, and drop emptied groups. */
function sanitizeTree(root: GridNode, liveIds: Set<string>): GridNode {
  const filtered = mapLeaves(root, (l) => {
    const tabs = l.tabs.filter((id) => liveIds.has(id))
    const activeTab = tabs.includes(l.activeTab ?? '')
      ? l.activeTab
      : (tabs[tabs.length - 1] ?? null)
    // Restore the activation history against surviving tabs (a leaf persisted before
    // this field existed simply has none — the close pick then falls back to the
    // positional neighbour). Kept only when non-empty so clean leaves stay clean.
    const tabHistory = (l.tabHistory ?? []).filter((id) => tabs.includes(id))
    const next: LeafNode = { ...l, tabs, activeTab }
    if (tabHistory.length) next.tabHistory = tabHistory
    else delete next.tabHistory
    return next
  })
  return pruneEmptyLeaves(filtered, FALLBACK_GROUP_ID)
}

/** Build the initial single-group state (used on first run / empty restore). */
export function emptyEditorState(rootGroupId: string): EditorState {
  const leaf = makeLeaf(rootGroupId)
  return {
    root: leaf,
    items: {},
    activeGroup: rootGroupId,
    mru: [rootGroupId],
    maximizedGroup: null,
    closed: [],
  }
}

/**
 * The scope a stored tab is restored into — the same rule an open obeys, or `null` to drop it.
 *
 * A stored tab that names no scope was written before every tab had one: it is dropped, never
 * shown in whichever chat opens first. A known kind is checked against its declaration (a session
 * kind stored without a session is dropped; an app-level one is global). A kind whose plugin has
 * not registered yet keeps its stored scope verbatim — guessing 'session' for it dropped every
 * global tab of a plugin still loading.
 */
function restoredScope(kind: WorkItem['kind'], stored: string | undefined): string | null {
  if (!stored) return null
  const kindScope = persistedScopeKindOf(kind)
  if (kindScope === 'global') return GLOBAL_SCOPE
  if (kindScope === 'session') return stored === GLOBAL_SCOPE ? null : stored
  return stored
}

/** Load + sanitize the persisted grid, or null when absent/empty. */
export function loadGrid(): EditorState | null {
  const raw = loadJSON<PersistedGrid>(STORAGE_KEY)
  if (!raw?.root || !Array.isArray(raw.items)) return null
  const items: Record<string, WorkItem> = {}
  for (const s of raw.items) {
    if (!s || typeof s.id !== 'string' || !isRestorableForPersistence(s.kind)) continue
    const scope = restoredScope(s.kind, s.scope)
    if (scope === null) continue
    items[s.id] = {
      kind: s.kind,
      id: s.id,
      title: s.kind === 'preview' ? 'Browser' : s.title,
      scope,
      ...(s.payload ? { payload: persistedPayload(s) } : {}),
    }
  }
  const root = sanitizeTree(raw.root, new Set(Object.keys(items)))
  const allGroups = leaves(root).map((l) => l.id)
  if (allGroups.length === 0) return null
  const activeGroup = allGroups.includes(raw.activeGroup) ? raw.activeGroup : allGroups[0]
  const maximizedGroup =
    raw.maximizedGroup && allGroups.includes(raw.maximizedGroup) ? raw.maximizedGroup : null
  return { root, items, activeGroup, mru: [activeGroup], maximizedGroup, closed: [] }
}

function writeGrid(state: EditorState): void {
  const items = Object.values(state.items).flatMap((i) =>
    isRestorableForPersistence(i.kind) ? [toSerializedItem(i)] : [],
  )
  const blob: PersistedGrid = {
    root: state.root,
    items,
    activeGroup: state.activeGroup,
    maximizedGroup: state.maximizedGroup,
  }
  saveJSON(STORAGE_KEY, blob)
}

// Flushed on quit and pagehide: a quit inside the 250 ms window used to drop the last layout.
let latest: EditorState | null = null
const gridWrite = createPendingWrite('workspace-grid', 250, () => {
  if (latest) writeGrid(latest)
})

/** Debounced write of the restorable slice. */
export function persistGrid(state: EditorState): void {
  if (typeof localStorage === 'undefined') return
  latest = state
  gridWrite.schedule()
}
