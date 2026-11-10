import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { FolderScan, RepositoryChain, ScanFolder } from '@rsaryev/llx-plugin'
import { isPathBelow } from '../../../../lib/path-containment'
import { diskFiles } from './files'

/**
 * The scope folders on the disk (`FolderScan`): `~`, the project chain, the managed settings
 * directory. A folder is read through `diskFiles` with its links followed wherever they lead. The
 * repository chain stops at the nearest folder holding `.git`; a `.git` file naming
 * `<main>/.git/worktrees/<name>` makes the folder a linked worktree of `<main>`.
 */
export interface DiskFolderScanOptions {
  /** The managed settings directory (`managedSettingsDir()`), or `undefined` for none. */
  readonly managedDirectory: string | undefined
}

const quiet = <T>(work: Promise<T>): Promise<T | undefined> => work.catch(() => undefined)

async function openFolder(dir: string): Promise<ScanFolder | undefined> {
  const info = await quiet(fs.stat(dir))
  if (!info?.isDirectory()) return undefined
  const files = diskFiles(dir, { linksLeave: true })
  return {
    dir,
    files,
    hostPath: (path) => files.hostPath(path),
    canonicalPath: (path) => quiet(fs.realpath(files.hostPath(path))),
  }
}

/** The main checkout a `.git` file points into, when it is a linked worktree's. */
async function mainCheckoutOf(top: string): Promise<string | undefined> {
  const text = await quiet(fs.readFile(join(top, '.git'), 'utf8'))
  const gitdir = text === undefined ? undefined : /^gitdir:\s*(.+)$/m.exec(text)?.[1]?.trim()
  if (gitdir === undefined) return undefined
  const linked = resolve(top, gitdir)
  const at = linked.lastIndexOf(`${sep}.git${sep}worktrees${sep}`)
  return at > 0 ? linked.slice(0, at) : undefined
}

async function repositoryOf(cwd: string): Promise<RepositoryChain> {
  const here = resolve(cwd)
  const walked: string[] = []
  for (let at = here; ; at = dirname(at)) {
    walked.push(at)
    const marker = await quiet(fs.stat(join(at, '.git')))
    if (marker?.isDirectory()) return { directories: walked }
    if (marker?.isFile()) {
      const main = await mainCheckoutOf(at)
      return { directories: walked, ...(main === undefined ? {} : { mainCheckout: main }) }
    }
    if (dirname(at) === at) return { directories: [here] }
  }
}

function directoriesBelow(start: string, touched: string): readonly string[] {
  const from = resolve(start)
  const file = resolve(touched)
  if (!isPathBelow(from, file)) return []
  const parts = relative(from, dirname(file))
    .split(sep)
    .filter((part) => part !== '')
  return parts.map((_part, index) => join(from, ...parts.slice(0, index + 1)))
}

export function diskFolderScan(options: DiskFolderScanOptions): FolderScan {
  return {
    managedDirectory: () => options.managedDirectory,
    open: openFolder,
    repository: repositoryOf,
    directoriesBelow: (start, touched) => Promise.resolve(directoriesBelow(start, touched)),
  }
}
