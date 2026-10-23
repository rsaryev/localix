/**
 * The Changes tree as ONE flat list of visible rows — the model that rendering,
 * keyboard navigation, typeahead and the context menu all read.
 *
 * The tree used to render recursively, so every row existed in the DOM and the
 * DOM was the only record of what was visible: arrow keys and typeahead queried
 * `[data-tree-path]`, which is exactly what a virtualized list cannot offer (a
 * row off screen is not mounted). With the rows computed here, the component can
 * mount a window of them while navigation still sees all of them — the host
 * Explorer's `fileTreeRows` shape, which the kit does not export.
 */
import { buildPathTree, type PathTreeNode } from '@localixai/mini-app-sdk/ui/path-tree'
import type { RepoFileChange } from '../../../../backend/source-control/contracts'

interface RowBase {
  /** Row identity: the path, which is what `data-tree-path` carries and roving focus remembers. */
  path: string
  /** The visible label (a compacted folder chain reads `a/b/c`). */
  name: string
  depth: number
}
export interface ChangesDirRow extends RowBase {
  kind: 'dir'
  isOpen: boolean
}
export interface ChangesFileRow extends RowBase {
  kind: 'file'
  file: RepoFileChange
}
export type ChangesTreeRow = ChangesDirRow | ChangesFileRow

/** Folder-first, sorted, single-child chains compacted — the SDK's one builder. */
export function buildChangesTree(files: readonly RepoFileChange[]): PathTreeNode<RepoFileChange>[] {
  return buildPathTree(files.map((file) => ({ path: file.path, value: file })))
}

/** The rows a person can currently see: every node whose ancestors are all open. */
export function flattenChangesTree(
  nodes: readonly PathTreeNode<RepoFileChange>[],
  collapsed: ReadonlySet<string>,
): ChangesTreeRow[] {
  const rows: ChangesTreeRow[] = []
  const walk = (level: readonly PathTreeNode<RepoFileChange>[], depth: number) => {
    for (const node of level) {
      if (node.type === 'leaf') {
        rows.push({ kind: 'file', path: node.value.path, name: node.name, depth, file: node.value })
        continue
      }
      const isOpen = !collapsed.has(node.path)
      rows.push({ kind: 'dir', path: node.path, name: node.name, depth, isOpen })
      if (isOpen) walk(node.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return rows
}

export type TreeNavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'
export type TreeNavigation = { kind: 'focus' | 'toggle'; path: string }

const NAV_KEYS = new Set<string>(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])
export const isTreeNavKey = (key: string): key is TreeNavKey => NAV_KEYS.has(key)

/**
 * What a navigation key does from `currentIndex`: Up/Down/Home/End move, Right
 * opens a closed folder or steps into an open one, Left closes an open folder or
 * climbs to the nearest shallower row (its parent). Null when it does nothing.
 */
export function changesTreeNavigation(
  rows: readonly ChangesTreeRow[],
  currentIndex: number,
  key: TreeNavKey,
): TreeNavigation | null {
  const current = rows[currentIndex]
  if (!current) return null
  const focus = (row: ChangesTreeRow | undefined): TreeNavigation | null =>
    row ? { kind: 'focus', path: row.path } : null
  if (key === 'Home') return focus(rows[0])
  if (key === 'End') return focus(rows[rows.length - 1])
  if (key === 'ArrowUp') return focus(rows[currentIndex - 1])
  if (key === 'ArrowDown') return focus(rows[currentIndex + 1])
  if (key === 'ArrowRight') {
    if (current.kind !== 'dir') return null
    if (!current.isOpen) return { kind: 'toggle', path: current.path }
    const child = rows[currentIndex + 1]
    return child && child.depth > current.depth ? focus(child) : null
  }
  if (current.kind === 'dir' && current.isOpen) return { kind: 'toggle', path: current.path }
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (rows[i]!.depth < current.depth) return focus(rows[i])
  }
  return null
}

/**
 * The typeahead prefix: characters typed within `timeoutMs` of each other accumulate, and one
 * character repeated collapses to itself (so `s` `s` `s` cycles the `s…` rows).
 */
export function createPrefixBuffer(timeoutMs = 600, now: () => number = Date.now) {
  let buffer = ''
  let lastAt = -Infinity
  return (char: string): string => {
    const t = now()
    if (t - lastAt > timeoutMs) buffer = ''
    lastAt = t
    buffer += char.toLowerCase()
    const repeated = buffer.length > 1 && buffer === buffer[0]!.repeat(buffer.length)
    return repeated ? buffer[0]! : buffer
  }
}

/**
 * The next row whose name starts with `prefix`, searching after `currentIndex`
 * and wrapping. A single character never matches the current row (so repeating
 * it cycles); a longer prefix keeps the current row as the last candidate (so
 * extending a still-matching prefix does not move focus).
 */
export function typeaheadMatch(
  rows: readonly ChangesTreeRow[],
  currentIndex: number,
  prefix: string,
): string | null {
  const needle = prefix.toLowerCase()
  const count = rows.length
  const last = needle.length === 1 ? count - 1 : count
  for (let step = 1; step <= last; step++) {
    const row = rows[(currentIndex + step + count) % count]!
    if (row.name.toLowerCase().startsWith(needle)) return row.path
  }
  return null
}
