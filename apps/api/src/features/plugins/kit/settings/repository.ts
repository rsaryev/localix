import { readFileSync, statSync, type Stats } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import type { RepositoryFacts } from '@rsaryev/llx-plugin/settings'

/**
 * What the disk says about the git repository a folder is in, for the kit's placement and trust
 * rules (`localSettingsRoot`, `workspaceTrustKey`): the nearest folder holding `.git`, a linked
 * checkout (a `.git` file naming `<main>/.git/worktrees/<name>`) resolved to its main one, and
 * whether the root, its `.git` and its `.claude` entry belong to the user running Localix.
 * Undefined outside a repository.
 */
export interface FolderRepository extends RepositoryFacts {
  /** The folder holding `.git`; in a linked checkout, the checkout itself. */
  readonly checkout: string
}

const statOf = (path: string): Stats | undefined => {
  try {
    return statSync(path)
  } catch {
    return undefined
  }
}

const textOf = (path: string): string => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

/** The main checkout a `.git` file points into, else the checkout itself. */
function mainOf(checkout: string, marker: string): string {
  const gitdir = /^gitdir:\s*(.+)$/m.exec(textOf(marker))?.[1]?.trim()
  const linked = gitdir ? resolve(checkout, gitdir) : ''
  const at = linked.lastIndexOf(`${sep}.git${sep}worktrees${sep}`)
  return at > 0 ? linked.slice(0, at) : checkout
}

/** Every entry that exists is the running user's; without a uid (Windows) all count as owned. */
function ownedByUser(paths: readonly string[]): boolean {
  const uid = process.getuid?.()
  if (uid === undefined) return true
  return paths.every((path) => {
    const stat = statOf(path)
    return stat === undefined || stat.uid === uid
  })
}

export function folderRepository(folder: string): FolderRepository | undefined {
  for (let current = resolve(folder); ; current = dirname(current)) {
    const marker = join(current, '.git')
    const stat = statOf(marker)
    if (stat?.isDirectory() || stat?.isFile()) {
      const root = stat.isFile() ? mainOf(current, marker) : current
      const owned = ownedByUser([root, join(root, '.git'), join(root, '.claude')])
      return { checkout: current, root, ownedByUser: owned }
    }
    if (dirname(current) === current) return undefined
  }
}
