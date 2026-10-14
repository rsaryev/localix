import type { WorkItem } from './workItem'
import type { EditorState } from './editor-state'
import { leaves, mapLeaves, type GridNode, type LeafNode } from './tree'
import { pushMru } from '@/shared/lib/mru'

/** The leaf currently holding tab `tabId`, or null. */
export function groupOfTab(root: GridNode, tabId: string): LeafNode | null {
  return leaves(root).find((l) => l.tabs.includes(tabId)) ?? null
}

/** Replace one leaf in the tree by id. */
export function patchLeaf(root: GridNode, leafId: string, fn: (l: LeafNode) => LeafNode): GridNode {
  return mapLeaves(root, (l) => (l.id === leafId ? fn(l) : l))
}

/** Drop item records no longer referenced by any group. */
export function gcItems(state: EditorState, root: GridNode): Record<string, WorkItem> {
  const live = new Set(leaves(root).flatMap((l) => l.tabs))
  const next: Record<string, WorkItem> = {}
  for (const [id, item] of Object.entries(state.items)) if (live.has(id)) next[id] = item
  return next
}

/** Push `group` to the front of the MRU (deduped). */
export function bumpMru(mru: string[], group: string): string[] {
  return pushMru(mru, group)
}

/** Active group fallback that actually exists in the tree. */
export function resolveActive(root: GridNode, preferred: string, mru: string[]): string {
  const ids = new Set(leaves(root).map((l) => l.id))
  if (ids.has(preferred)) return preferred
  const fromMru = mru.find((g) => ids.has(g))
  return fromMru ?? leaves(root)[0].id
}
