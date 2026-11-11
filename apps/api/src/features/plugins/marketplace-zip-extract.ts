import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
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
 *
 * Spelling is not where an entry lands. A link already written can make a later entry's parent
 * resolve elsewhere, and on a case-insensitive file system (macOS APFS) `a/` IS the link `A`: so
 * before each entry is created, the real path of the nearest folder it goes under must be inside the
 * real path of `dest`, and once every link is written each must point inside it, followed through
 * the links really there (`holdLink`).
 * This holds whatever the scan judged; a refusal leaves the caller to remove `dest`.
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

function outside(member: ZipMember): UnprocessableError {
  return new UnprocessableError(
    'plugin_archive_invalid',
    `Archive entry ${member.name} resolves outside the plugin`,
  )
}

const missing = (err: NodeJS.ErrnoException) => err.code === 'ENOENT' || err.code === 'ENOTDIR'

/** The real path of `path`, or `undefined` when nothing is there (a dangling link is not nothing). */
async function realOrNothing(path: string): Promise<string | undefined> {
  try {
    return await fs.realpath(path)
  } catch (err) {
    if (!missing(err as NodeJS.ErrnoException)) throw err
    const there = await fs.lstat(path).then(
      () => true,
      () => false,
    )
    if (there) throw err
    return undefined
  }
}

/** Refuse `member` unless the nearest existing folder at or above `path` is really inside `realDest`. */
async function holdUnder(member: ZipMember, path: string, realDest: string): Promise<void> {
  let at = path
  let real = await realOrNothing(at)
  while (real === undefined && dirname(at) !== at) {
    at = dirname(at)
    real = await realOrNothing(at)
  }
  if (real === undefined || !isPathWithin(realDest, real)) throw outside(member)
}

/** Follow one segment of a link's target from `at`: a real path, or one under a missing folder. */
async function step(at: string, segment: string): Promise<string> {
  if (segment === '' || segment === '.') return at
  if (segment === '..') return dirname(at)
  const next = join(at, segment)
  return (await realOrNothing(next)) ?? next
}

/**
 * Refuse `member`, a written link, unless where it points really is inside `realDest`, whether or
 * not anything is there: its target is followed one segment at a time from the real folder the link
 * is in, each existing step by its real path, so neither a `..` after a link nor a target that is
 * missing today can name a place outside. A step through a dangling link cannot be followed and is
 * refused.
 */
async function holdLink(member: ZipMember, target: string, realDest: string): Promise<void> {
  const pointsAt = await fs.readlink(target)
  let at = isAbsolute(pointsAt) ? sep : await fs.realpath(dirname(target))
  for (const segment of pointsAt.split('/')) at = await step(at, segment)
  if (!isPathWithin(realDest, at)) throw outside(member)
}

/** The folder an entry is created in: a folder entry's own path, mkdir'd recursively. */
const parentOf = (kind: Kind, target: string): string =>
  kind === 'folder' ? target : dirname(target)

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
  const realDest = await fs.realpath(base)
  const unwritable = (member: ZipMember) => (err: unknown) => {
    if (err instanceof UnprocessableError) throw err
    throw new UnprocessableError(
      'plugin_archive_invalid',
      `Archive entry ${member.name} cannot be written: ${errorMessage(err)}`,
    )
  }
  for (const one of placed)
    await holdUnder(one.member, parentOf(one.kind, one.target), realDest)
      .then(() => WRITE[one.kind](zip, one.member, one.target))
      .catch(unwritable(one.member))
  // A link may point through one written after it, so links are judged once all are there.
  for (const one of placed.filter((p) => p.kind === 'link'))
    await holdLink(one.member, one.target, realDest).catch(unwritable(one.member))
}
