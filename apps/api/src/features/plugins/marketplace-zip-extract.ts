import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { inflateRaw } from 'node:zlib'

import { isPathWithin } from '../../lib/path-containment'
import { UnprocessableError } from '../../lib/domain-errors'
import { errorMessage } from '../../lib/errors'
import { isZipLink, type ZipMember } from './marketplace-zip-scan'

/**
 * Writing a zip the kit has judged (`fetchArchive`, `unsafeEntryIssue`): exactly the members the
 * scan listed, the same ones and the same links the kit saw, so no extractor of its own reading of
 * the zip (Info-ZIP's `unzip` takes link modes from systems the scan does not) can write what the
 * kit never judged. Each entry is inflated against the size it declares, each path is held inside
 * `dest`, a file is created only where nothing is (a duplicate entry is refused, never written
 * over), folders come first and links last, so nothing is ever written through a link.
 */

const inflate = promisify(inflateRaw)

function lies(member: ZipMember, detail: string): UnprocessableError {
  return new UnprocessableError(
    'plugin_archive_too_large',
    `Archive entry ${member.name} declares ${member.bytes} bytes but ${detail}`,
  )
}

/** One entry's bytes, held to its declared size. */
async function contentOf(zip: Buffer, member: ZipMember): Promise<Buffer> {
  const data = zip.subarray(member.dataStart, member.dataStart + member.compressedBytes)
  if (member.method === 0) return data
  const out = await inflate(data, { maxOutputLength: Math.max(1, member.bytes) }).catch(
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ERR_BUFFER_TOO_LARGE') throw lies(member, 'inflates to more')
      throw new UnprocessableError(
        'plugin_archive_invalid',
        `Archive entry ${member.name} does not inflate: ${err.message}`,
      )
    },
  )
  if (out.length !== member.bytes) throw lies(member, `inflates to ${out.length}`)
  return out
}

type Kind = 'folder' | 'file' | 'link'
const kindOf = (member: ZipMember): Kind =>
  isZipLink(member) ? 'link' : member.name.endsWith('/') ? 'folder' : 'file'

/** Where a member lands under `dest`, or `undefined` when it is outside `root` (or is `root`). */
function targetOf(member: ZipMember, root: string, dest: string): string | undefined {
  const prefix = root === '' ? '' : `${root}/`
  if (!member.name.startsWith(prefix)) return undefined
  const rel = member.name.slice(prefix.length).replace(/\/+$/, '')
  if (rel === '') return undefined
  const target = resolve(dest, rel)
  if (target === dest || !isPathWithin(dest, target))
    throw new UnprocessableError(
      'plugin_archive_invalid',
      `Archive entry ${member.name} leaves the plugin`,
    )
  return target
}

const WRITE: Record<Kind, (zip: Buffer, member: ZipMember, target: string) => Promise<void>> = {
  folder: async (_zip, _member, target) => {
    await fs.mkdir(target, { recursive: true })
  },
  file: async (zip, member, target) => {
    await fs.mkdir(dirname(target), { recursive: true })
    const mode = (member.unixMode ?? 0) & 0o111 ? 0o755 : 0o644
    await fs.writeFile(target, await contentOf(zip, member), { flag: 'wx', mode })
  },
  link: async (zip, member, target) => {
    await fs.mkdir(dirname(target), { recursive: true })
    await fs.symlink((await contentOf(zip, member)).toString('utf8'), target)
  },
}

const ORDER: readonly Kind[] = ['folder', 'file', 'link']

/** Write the members under `root` (`''`: the whole zip) into `dest`, which must not exist yet. */
export async function extractZipMembers(
  zip: Buffer,
  members: readonly ZipMember[],
  root: string,
  dest: string,
): Promise<void> {
  const base = resolve(dest)
  const placed = members.flatMap((member) => {
    const target = targetOf(member, root, base)
    return target === undefined ? [] : [{ member, target, kind: kindOf(member) }]
  })
  placed.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
  await fs.mkdir(base, { recursive: true })
  for (const one of placed)
    await WRITE[one.kind](zip, one.member, one.target).catch((err: unknown) => {
      if (err instanceof UnprocessableError) throw err
      throw new UnprocessableError(
        'plugin_archive_invalid',
        `Archive entry ${one.member.name} cannot be written: ${errorMessage(err)}`,
      )
    })
}
