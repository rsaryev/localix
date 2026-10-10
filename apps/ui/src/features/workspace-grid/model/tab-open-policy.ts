import { resolveTabIdentity, tabIdentityOf, type WorkItem } from './workItem'
import { isCappedFileItem, isPathBacked, isPinnedItem } from './capabilities'
import { scopeOf } from './scope'
import type { EditorState, OpenOptions } from './editor-state'

/** Max real file tabs per GROUP before the oldest non-active one is evicted. */
export const MAX_FILE_TABS = 12

/** Evict the oldest non-active capped file tab(s) in one group past the cap. */
export function capFileTabs(
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

/** Resolve the preview (ephemeral) flag when REVEALING an already-open tab. An
 *  explicit pin (`opts.ephemeral === false`, e.g. a file-tree double-click) pins
 *  it; otherwise the ORIGINAL rule holds — a pinned tab never reverts to a preview,
 *  else the incoming intent is taken. Never un-pins on reveal, so an agent's
 *  ephemeral re-open can't demote a user-pinned tab. */
export function resolveRevealEphemeral(
  prevItem: WorkItem | undefined,
  item: WorkItem,
  opts: OpenOptions,
): boolean | undefined {
  if (opts.ephemeral === false) return false
  return isPinnedItem(prevItem) ? false : item.ephemeral
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
export function findReusableTabId(state: EditorState, item: WorkItem): string | null {
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
