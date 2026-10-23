export interface PathTreeDir<T> {
  type: 'dir'
  name: string
  path: string
  children: Array<PathTreeNode<T>>
}

export interface PathTreeLeaf<T> {
  type: 'leaf'
  name: string
  path: string
  value: T
}

export type PathTreeNode<T> = PathTreeDir<T> | PathTreeLeaf<T>

export interface PathTreeItem<T> {
  path: string
  value: T
}

/**
 * One collator for every sort. `localeCompare` resolves the locale's collation rules on EACH call,
 * which made sorting a 5,000-entry change list measurably slower than building it; a constructed
 * `Intl.Collator` resolves them once and orders identically.
 */
const nameCollator = new Intl.Collator()

function sortDirectory<T>(directory: PathTreeDir<T>): void {
  directory.children.sort((left, right) => {
    if (left.type !== right.type) return left.type === 'dir' ? -1 : 1
    return nameCollator.compare(left.name, right.name)
  })
  for (const child of directory.children) {
    if (child.type === 'dir') sortDirectory(child)
  }
}

function compactDirectory<T>(directory: PathTreeDir<T>): void {
  for (const child of directory.children) {
    if (child.type !== 'dir') continue
    while (child.children.length === 1 && child.children[0]?.type === 'dir') {
      const only = child.children[0]
      child.name = `${child.name}/${only.name}`
      child.path = only.path
      child.children = only.children
    }
    compactDirectory(child)
  }
}

/** Build a folder-first, sorted tree and compact single-directory chains. */
export function buildPathTree<T>(
  items: ReadonlyArray<PathTreeItem<T>>,
  folders: ReadonlyArray<string> = [],
): Array<PathTreeNode<T>> {
  const root: PathTreeDir<T> = {
    type: 'dir',
    name: '',
    path: '',
    children: [],
  }

  // Folders by full path. Finding a child folder with `children.find` scanned every sibling —
  // leaves included — for every path segment of every item, so a folder holding thousands of
  // entries made the build quadratic in its size. Keyed by path, each segment is one lookup.
  const folderByPath = new Map<string, PathTreeDir<T>>([['', root]])
  const ensureFolder = (folderPath: string): PathTreeDir<T> => {
    const parts = folderPath.split('/').filter(Boolean)
    const known = folderByPath.get(parts.join('/'))
    if (known) return known
    let cursor = root
    for (const name of parts) {
      const path = cursor.path ? `${cursor.path}/${name}` : name
      let next = folderByPath.get(path)
      if (!next) {
        next = { type: 'dir', name, path, children: [] }
        cursor.children.push(next)
        folderByPath.set(path, next)
      }
      cursor = next
    }
    return cursor
  }

  for (const folder of folders) ensureFolder(folder)
  for (const item of items) {
    const parts = item.path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    const cursor = ensureFolder(parts.slice(0, -1).join('/'))
    cursor.children.push({
      type: 'leaf',
      name: parts[parts.length - 1]!,
      path: item.path,
      value: item.value,
    })
  }
  sortDirectory(root)
  compactDirectory(root)
  return root.children
}

export function folderPaths<T>(nodes: ReadonlyArray<PathTreeNode<T>>): string[] {
  const paths: string[] = []
  const visit = (items: ReadonlyArray<PathTreeNode<T>>) => {
    for (const item of items) {
      if (item.type !== 'dir') continue
      paths.push(item.path)
      visit(item.children)
    }
  }
  visit(nodes)
  return paths
}
