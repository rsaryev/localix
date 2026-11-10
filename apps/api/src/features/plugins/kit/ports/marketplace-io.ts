import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import type { PluginFiles } from '@rsaryev/llx-plugin'
import type {
  ArchiveReader,
  GitTags,
  PluginDirectories,
  PluginStateStore,
  Sha256,
} from '@rsaryev/llx-plugin/marketplace'
import { errorMessage } from '../../../../lib/errors'
import { scanZip, type ZipMember } from '../../marketplace-zip-scan'
import { diskFiles } from './files'

/**
 * The marketplace's small effects: a digest, a zip's entry list, a repository's tags, the state
 * files under the plugins root and a printed directory opened for reading. The kit judges every
 * limit, path and link; these only read and write.
 */

export const nodeSha256: Sha256 = {
  hex: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
}

/** No limit of Localix's own: the kit holds the archive to the documented ones itself. */
const NO_LIMITS = {
  maxEntries: Infinity,
  maxFileBytes: Infinity,
  maxTotalBytes: Infinity,
  maxRatio: Infinity,
}
const S_IFMT = 0o170000
const S_IFLNK = 0o120000

const linkTarget = (zip: Buffer, member: ZipMember): string => {
  const data = zip.subarray(member.dataStart, member.dataStart + member.compressedBytes)
  return (member.method === 8 ? inflateRawSync(data) : data).toString('utf8')
}

export const zipArchiveReader: ArchiveReader = {
  async scan(bytes, signal) {
    if (signal.aborted) return { failure: 'aborted', message: 'The archive scan was cancelled' }
    try {
      const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      const entries = scanZip(zip, NO_LIMITS).members.map((member) => {
        const isSymlink = ((member.unixMode ?? 0) & S_IFMT) === S_IFLNK
        return {
          path: member.name,
          size: member.bytes,
          isSymlink,
          ...(isSymlink ? { linkTarget: linkTarget(zip, member) } : {}),
        }
      })
      return { entries }
    } catch (error) {
      return { failure: 'corrupt', message: errorMessage(error) }
    }
  },
}

/** A shorthand is listed over HTTPS: tags need no SSH key, and a public repository needs no sign-in. */
export function gitTags(listTags: (url: string) => Promise<readonly string[]>): GitTags {
  return {
    async list(repository, signal) {
      if (signal.aborted) return { failure: 'aborted', message: 'The tag listing was cancelled' }
      const url =
        'shorthand' in repository
          ? `https://github.com/${repository.shorthand}.git`
          : repository.url
      try {
        return await listTags(url)
      } catch (error) {
        const killed = (error as { killed?: boolean }).killed === true
        return { failure: killed ? 'timeout' : 'connection', message: errorMessage(error) }
      }
    },
  }
}

/** The files directly under the plugins root; a write goes to a temporary file renamed over it. */
export function diskPluginStateStore(root: () => string): PluginStateStore {
  return {
    read: (name) => fs.readFile(join(root(), name), 'utf8').catch(() => undefined),
    async write(name, text) {
      const file = join(root(), name)
      const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
      try {
        await fs.mkdir(root(), { recursive: true })
        await fs.writeFile(temporary, text)
        await fs.rename(temporary, file)
        return undefined
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => {})
        return { failure: 'write', message: errorMessage(error) }
      }
    },
    names: async () =>
      (await fs.readdir(root()).catch(() => [])).toSorted((a, b) => a.localeCompare(b)),
    modifiedAt: async (name) => (await fs.stat(join(root(), name)).catch(() => undefined))?.mtimeMs,
    async remove(name) {
      try {
        await fs.rm(join(root(), name), { force: true })
        return undefined
      } catch (error) {
        return { failure: 'remove', message: errorMessage(error) }
      }
    },
  }
}

/** An existing directory, as read-only files rooted there. */
export async function openDirectory(path: string): Promise<PluginFiles | undefined> {
  const info = await fs.stat(path).catch(() => undefined)
  return info?.isDirectory() ? diskFiles(path) : undefined
}

export const diskPluginDirectories: PluginDirectories = { open: openDirectory }
