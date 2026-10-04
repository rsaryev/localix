// Pure flattener: the nested folder/file/match search tree → one authoritative
// top-to-bottom row layout. Kept React-free so it stays unit-testable, and kept
// separate from `searchTree.ts` so grouping (a property of the results) and layout
// (a property of what is expanded) can be tested apart from each other.
//
// This is the same shape the Explorer uses (`fileTreeRows.ts`): rendering and the
// virtualizer both consume this array, so a row's position exists whether or not its
// DOM node is mounted.
import type { FileContentMatch } from '@/shared/api/contracts'
import type { SearchDirNode, SearchFileNode, SearchTreeNode } from './searchTree'

export interface SearchDirRow {
  kind: 'dir'
  key: string
  depth: number
  node: SearchDirNode
  isOpen: boolean
}

export interface SearchFileRow {
  kind: 'file'
  key: string
  depth: number
  node: SearchFileNode
  isOpen: boolean
}

export interface SearchMatchRow {
  kind: 'match'
  key: string
  depth: number
  /** Owning file's project-relative path (the match carries it too, but rows read it). */
  path: string
  match: FileContentMatch
  /** Surrounding source lines rendered inside this row — what makes rows variable-height. */
  contextLines: number
}

export type SearchRow = SearchDirRow | SearchFileRow | SearchMatchRow

/**
 * Project the result tree into visible rows, top to bottom. A collapsed node keeps
 * its own row and drops its descendants — identical to what the recursive renderer
 * produced, only flat.
 */
export function flattenSearchRows(
  nodes: readonly SearchTreeNode[],
  collapsed: ReadonlySet<string>,
): SearchRow[] {
  const rows: SearchRow[] = []

  const walk = (list: readonly SearchTreeNode[], depth: number) => {
    for (const node of list) {
      const isOpen = !collapsed.has(node.path)
      if (node.type === 'dir') {
        rows.push({ kind: 'dir', key: `d:${node.path}`, depth, node, isOpen })
        if (isOpen) walk(node.children, depth + 1)
        continue
      }
      rows.push({ kind: 'file', key: `f:${node.path}`, depth, node, isOpen })
      if (!isOpen) continue
      node.matches.forEach((match, index) => {
        rows.push({
          kind: 'match',
          // Index-qualified: two matches on one line with the same span would
          // otherwise collide and make the virtualizer reuse one row for both.
          key: `m:${node.path}:${index}:${match.line}:${match.matchStart}`,
          depth: depth + 1,
          path: node.path,
          match,
          contextLines: (match.before?.length ?? 0) + (match.after?.length ?? 0),
        })
      })
    }
  }

  walk(nodes, 0)
  return rows
}

/** Line box of the smallest text tier used by result rows (`--text-2xs--line-height`). */
const LINE = 16
/** Folder/file header row: one line box plus its `py-[0.2rem]`. */
const HEADER_ROW = LINE + 7
/** Match line: one line box plus its `py-[0.1rem]`. */
const MATCH_LINE = LINE + 3
/** Dim surrounding-source line: one line box plus its `py-[0.05rem]`. */
const CONTEXT_LINE = LINE + 2

/**
 * Pre-measurement size for one row. A match row is as tall as its match line plus
 * every surrounding context line rendered with it, so context lines make rows
 * genuinely variable-height. The virtualizer still measures each mounted row; a good
 * estimate only keeps the scrollbar honest for the rows that were never mounted.
 */
export function estimateSearchRowSize(row: SearchRow | undefined): number {
  if (!row) return HEADER_ROW
  if (row.kind !== 'match') return HEADER_ROW
  return MATCH_LINE + row.contextLines * CONTEXT_LINE
}
