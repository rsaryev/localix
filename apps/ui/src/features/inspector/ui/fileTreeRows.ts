import type { DirEntry } from '@/shared/api/contracts'

import type { FileTreeFilter } from './fileTreeFilter'
import { basenameOf, computeCompactChain, type VisibleRow } from './fileTreePaths'
import type { EditState } from './useFileTree'

export interface FileTreeEntryRow extends VisibleRow {
  kind: 'entry'
  key: string
  depth: number
  parentPath: string
  entry: DirEntry
  compactChain: string[]
  isOpen: boolean
  filtering: boolean
  ariaPosInSet: number
  ariaSetSize: number
}

export interface FileTreeEditRow {
  kind: 'edit'
  key: string
  depth: number
  edit: EditState
}

export interface FileTreeStatusRow {
  kind: 'status'
  key: string
  depth: number
  parentPath: string
  status: 'empty' | 'loading' | 'truncated'
  count?: number
}

export type FileTreeRow = FileTreeEntryRow | FileTreeEditRow | FileTreeStatusRow

export interface FlattenFileTreeRowsInput {
  root: string
  childrenByPath: Record<string, DirEntry[]>
  truncatedByPath: Record<string, number>
  expanded: ReadonlySet<string>
  loading: ReadonlySet<string>
  edit: EditState | null
  filter: FileTreeFilter | null
  compactEnabled: boolean
}

/**
 * Project all visible Explorer state into one authoritative top-to-bottom layout.
 *
 * Rendering, range selection, keyboard navigation, typeahead, and reveal consume
 * this same array. Keeping status/edit rows in the layout also lets the virtualizer
 * preserve the exact position of loading, empty, truncated, and inline-edit UI.
 */
export function flattenFileTreeRows(input: FlattenFileTreeRowsInput): FileTreeRow[] {
  const rows: FileTreeRow[] = []

  const walk = (parentPath: string, depth: number, unfiltered = false) => {
    const entries = input.childrenByPath[parentPath]
    if (!entries) return
    const filtering = input.filter !== null && !unfiltered

    if (input.edit?.mode === 'create' && input.edit.parentPath === parentPath) {
      rows.push({
        kind: 'edit',
        key: `edit:create:${parentPath}`,
        depth,
        edit: input.edit,
      })
    }

    if (entries.length === 0) {
      if (!(input.edit?.mode === 'create' && input.edit.parentPath === parentPath)) {
        rows.push({
          kind: 'status',
          key: `status:empty:${parentPath}`,
          depth,
          parentPath,
          status: 'empty',
        })
      }
      return
    }

    const siblingRows: FileTreeEntryRow[] = []
    for (const entry of entries) {
      const full = `${parentPath}/${entry.name}`
      if (filtering && !input.filter!.visible.has(full)) continue

      if (input.edit?.mode === 'rename' && input.edit.path === full) {
        rows.push({
          kind: 'edit',
          key: `edit:rename:${full}`,
          depth,
          edit: input.edit,
        })
        continue
      }

      if (entry.type === 'file') {
        const row: FileTreeEntryRow = {
          kind: 'entry',
          key: `entry:${full}`,
          path: full,
          name: entry.name,
          type: 'file',
          depth,
          parentPath,
          entry,
          compactChain: [full],
          isOpen: false,
          filtering,
          ariaPosInSet: 0,
          ariaSetSize: 0,
        }
        rows.push(row)
        siblingRows.push(row)
        continue
      }

      const compactChain =
        input.compactEnabled && !filtering
          ? computeCompactChain(full, input.childrenByPath, input.expanded)
          : [full]
      const endpoint = compactChain[compactChain.length - 1]!
      const isCompact = compactChain.length > 1
      const rowParent = isCompact ? endpoint.slice(0, endpoint.lastIndexOf('/')) : parentPath
      const rowName = basenameOf(endpoint)
      const isOpen = input.expanded.has(endpoint) || (filtering && input.filter!.expand.has(full))

      const row: FileTreeEntryRow = {
        kind: 'entry',
        key: `entry:${endpoint}`,
        path: endpoint,
        name: rowName,
        type: 'dir',
        depth,
        parentPath: rowParent,
        entry: isCompact ? { name: rowName, type: 'dir' } : entry,
        compactChain,
        isOpen,
        filtering,
        ariaPosInSet: 0,
        ariaSetSize: 0,
      }
      rows.push(row)
      siblingRows.push(row)

      if (!isOpen) continue
      if (input.loading.has(endpoint)) {
        rows.push({
          kind: 'status',
          key: `status:loading:${endpoint}`,
          depth: depth + 1,
          parentPath: endpoint,
          status: 'loading',
        })
      } else {
        walk(endpoint, depth + 1, unfiltered || (input.filter?.showAllUnder.has(full) ?? false))
      }
    }

    siblingRows.forEach((row, index) => {
      row.ariaPosInSet = index + 1
      row.ariaSetSize = siblingRows.length
    })

    const truncated = input.truncatedByPath[parentPath]
    if (!filtering && truncated) {
      rows.push({
        kind: 'status',
        key: `status:truncated:${parentPath}`,
        depth,
        parentPath,
        status: 'truncated',
        count: truncated,
      })
    }
  }

  walk(input.root, 0)
  return rows
}

export const fileTreeEntryRows = (rows: readonly FileTreeRow[]): FileTreeEntryRow[] =>
  rows.filter((row): row is FileTreeEntryRow => row.kind === 'entry')

export type FileTreeNavigationKey =
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Home'
  | 'End'

export type FileTreeNavigation = { kind: 'focus'; path: string } | { kind: 'toggle'; path: string }

/**
 * Resolve tree navigation from the flat semantic model rather than mounted DOM.
 * Status/edit rows are intentionally absent from `rows`: arrow and typeahead
 * movement only visits actual ARIA treeitems.
 */
export function fileTreeNavigation(
  rows: readonly FileTreeEntryRow[],
  currentPath: string,
  key: FileTreeNavigationKey,
): FileTreeNavigation | null {
  const index = rows.findIndex((row) => row.path === currentPath)
  if (index < 0) return null
  const current = rows[index]!

  if (key === 'Home' || key === 'End') {
    const target = rows[key === 'Home' ? 0 : rows.length - 1]
    return target ? { kind: 'focus', path: target.path } : null
  }
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const target = rows[index + (key === 'ArrowDown' ? 1 : -1)]
    return target ? { kind: 'focus', path: target.path } : null
  }
  if (key === 'ArrowRight') {
    if (current.type !== 'dir') return null
    if (!current.isOpen) return { kind: 'toggle', path: current.path }
    const child = rows[index + 1]
    return child && child.depth > current.depth ? { kind: 'focus', path: child.path } : null
  }
  if (current.type === 'dir' && current.isOpen) {
    return { kind: 'toggle', path: current.path }
  }
  for (let parentIndex = index - 1; parentIndex >= 0; parentIndex--) {
    const candidate = rows[parentIndex]!
    if (candidate.depth < current.depth) return { kind: 'focus', path: candidate.path }
  }
  return null
}
