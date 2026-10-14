// Pure builder: flat content-search matches → a nested folder/file tree.
// Kept React-free so it's unit-testable.
import type { FileContentMatch } from '@/shared/api/contracts'

export interface SearchFileNode {
  type: 'file'
  /** Last path segment (basename). */
  name: string
  /** Full project-relative path. */
  path: string
  matches: FileContentMatch[]
}

export interface SearchDirNode {
  type: 'dir'
  name: string
  /** Full project-relative path of this directory. */
  path: string
  children: SearchTreeNode[]
  /** Total matches under this directory (recursive). */
  count: number
}

export type SearchTreeNode = SearchDirNode | SearchFileNode

interface MutableDir {
  dirs: Map<string, MutableDir>
  files: Map<string, FileContentMatch[]>
  order: string[] // first-seen order of child keys (dirs + files)
}

const emptyDir = (): MutableDir => ({ dirs: new Map(), files: new Map(), order: [] })

/**
 * Group matches into a nested directory tree. Files and directories keep
 * first-seen order (ripgrep emits files grouped already, so this preserves a
 * stable, scan-order layout). Directory `count` is the recursive match total.
 */
export function buildSearchTree(matches: FileContentMatch[]): SearchTreeNode[] {
  const root = emptyDir()

  for (const m of matches) {
    const segments = m.path.split('/').filter(Boolean)
    if (segments.length === 0) continue
    const fileName = segments[segments.length - 1]!
    const dirs = segments.slice(0, -1)

    let cursor = root
    for (const seg of dirs) {
      if (!cursor.dirs.has(seg)) {
        cursor.dirs.set(seg, emptyDir())
        cursor.order.push(`d:${seg}`)
      }
      cursor = cursor.dirs.get(seg)!
    }
    if (!cursor.files.has(fileName)) {
      cursor.files.set(fileName, [])
      cursor.order.push(`f:${fileName}`)
    }
    cursor.files.get(fileName)!.push(m)
  }

  const toNodes = (dir: MutableDir, prefix: string): { nodes: SearchTreeNode[]; count: number } => {
    const nodes: SearchTreeNode[] = []
    let count = 0
    for (const key of dir.order) {
      const name = key.slice(2)
      if (key.startsWith('d:')) {
        const childPath = prefix ? `${prefix}/${name}` : name
        const { nodes: childNodes, count: childCount } = toNodes(dir.dirs.get(name)!, childPath)
        nodes.push({ type: 'dir', name, path: childPath, children: childNodes, count: childCount })
        count += childCount
      } else {
        const fileMatches = dir.files.get(name)!
        const filePath = prefix ? `${prefix}/${name}` : name
        nodes.push({ type: 'file', name, path: filePath, matches: fileMatches })
        count += fileMatches.length
      }
    }
    return { nodes, count }
  }

  return toNodes(root, '').nodes
}

/** Every node path in the tree (dirs + files) — for collapse-all. */
export function collectNodePaths(nodes: SearchTreeNode[]): string[] {
  const out: string[] = []
  const walk = (ns: SearchTreeNode[]) => {
    for (const n of ns) {
      out.push(n.path)
      if (n.type === 'dir') walk(n.children)
    }
  }
  walk(nodes)
  return out
}
