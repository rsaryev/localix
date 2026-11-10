import { promises as fs } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type { DirectoryEntry, FileStat, PluginFiles } from '@rsaryev/llx-plugin'
import { isPathWithin } from '../../../../lib/path-containment'

/**
 * A folder on the disk as the kit reads it (`PluginFiles`): paths are relative to the folder,
 * `/`-separated, `.` is the folder itself, and none leaves it. Reads and listings follow a
 * symbolic link only while its target stays inside the folder; `stat` reports every link it is
 * asked about, dangling or leaving, with where it points (`realPath`: relative when inside, the
 * absolute host path when not), so the kit can judge the escape. A directory's size is 0, as the
 * kit's reference fake has it. A scope folder (`~`, the project) is opened with `linksLeave`: its
 * links are followed wherever they lead, as a person links skills in from a dotfiles checkout.
 * Nothing here throws for an absent path: it is `undefined`.
 */
export interface DiskFiles extends PluginFiles {
  /** The folder, as it was given. */
  readonly root: string
  /** The host path of a path below the folder. */
  hostPath(path: string): string
}

const posix = (path: string): string => path.split(sep).join('/')
const escapes = (path: string): boolean =>
  path.startsWith('/') || path.split('/').includes('..') || /^[A-Za-z]:/.test(path)
const quiet = <T>(work: Promise<T>): Promise<T | undefined> => work.catch(() => undefined)

export interface DiskFilesOptions {
  /** Follow links that lead out of the folder (a scope folder), not only those inside it (a plugin). */
  readonly linksLeave?: boolean
}

export function diskFiles(root: string, options: DiskFilesOptions = {}): DiskFiles {
  const hostPath = (path: string): string => (path === '.' ? root : join(root, path))
  let canonical: Promise<string> | undefined
  const rootReal = (): Promise<string> =>
    (canonical ??= fs.realpath(root).catch(() => resolve(root)))

  /** The real path of `path` when it exists and stays inside the folder. */
  const inside = async (path: string): Promise<string | undefined> => {
    if (escapes(path)) return undefined
    const real = await quiet(fs.realpath(hostPath(path)))
    if (real === undefined) return undefined
    return options.linksLeave === true || isPathWithin(await rootReal(), real) ? real : undefined
  }

  const linkTarget = async (path: string): Promise<string | undefined> => {
    const real = await quiet(fs.realpath(hostPath(path)))
    if (real !== undefined) return real
    const written = await quiet(fs.readlink(hostPath(path)))
    return written === undefined ? undefined : resolve(dirname(hostPath(path)), written)
  }

  const stat = async (path: string): Promise<FileStat | undefined> => {
    if (escapes(path)) return undefined
    const own = await quiet(fs.lstat(hostPath(path)))
    if (own === undefined) return undefined
    if (!own.isSymbolicLink())
      return {
        isFile: own.isFile(),
        isDirectory: own.isDirectory(),
        isSymlink: false,
        size: own.isFile() ? own.size : 0,
      }
    const target = await linkTarget(path)
    const base = await rootReal()
    const stays = target !== undefined && isPathWithin(base, target)
    const follows = target !== undefined && (stays || options.linksLeave === true)
    const followed = follows ? await quiet(fs.stat(target)) : undefined
    return {
      isFile: followed?.isFile() ?? false,
      isDirectory: followed?.isDirectory() ?? false,
      isSymlink: true,
      size: followed?.isFile() ? followed.size : 0,
      ...(target === undefined
        ? {}
        : { realPath: stays ? posix(relative(base, target)) || '.' : target }),
    }
  }

  const list = async (path: string): Promise<readonly DirectoryEntry[] | undefined> => {
    const real = await inside(path)
    if (real === undefined) return undefined
    const entries = await quiet(fs.readdir(real, { withFileTypes: true }))
    if (entries === undefined) return undefined
    return Promise.all(
      entries.map(async (entry): Promise<DirectoryEntry> => {
        if (!entry.isSymbolicLink())
          return { name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() }
        const linked = await stat(path === '.' ? entry.name : `${path}/${entry.name}`)
        return {
          name: entry.name,
          isFile: linked?.isFile ?? false,
          isDirectory: linked?.isDirectory ?? false,
        }
      }),
    )
  }

  const regularFile = async (path: string): Promise<string | undefined> => {
    const real = await inside(path)
    const info = real === undefined ? undefined : await quiet(fs.stat(real))
    return info?.isFile() ? real : undefined
  }

  return {
    root,
    hostPath,
    stat,
    list,
    exists: async (path) => (await stat(path)) !== undefined,
    readText: async (path) => {
      const real = await regularFile(path)
      return real === undefined ? undefined : quiet(fs.readFile(real, 'utf8'))
    },
    readBytes: async (path) => {
      const real = await regularFile(path)
      const bytes = real === undefined ? undefined : await quiet(fs.readFile(real))
      return bytes === undefined ? undefined : new Uint8Array(bytes)
    },
  }
}
