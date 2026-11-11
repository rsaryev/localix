import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { FolderScan, RepositoryChain, ScanFolder } from '@rsaryev/llx-plugin'
import { isPathBelow } from '../../../../lib/path-containment'
import { folderRepository } from '../settings/repository'
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

/** The folders from `cwd` up to its checkout, and the main checkout of a linked one (`folderRepository`). */
async function repositoryOf(cwd: string): Promise<RepositoryChain> {
  const here = resolve(cwd)
  const repository = folderRepository(here)
  if (!repository) return { directories: [here] }
  const directories = [here]
  while (directories.at(-1) !== repository.checkout) directories.push(dirname(directories.at(-1)!))
  const { root, checkout } = repository
  return { directories, ...(root === checkout ? {} : { mainCheckout: root }) }
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
