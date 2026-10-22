import { UnprocessableError } from '../../lib/domain-errors'

/**
 * Claude Code's extraction limits for an `archive` plugin source, checked against the zip's
 * central directory before anything is unpacked: entry count, any one file's uncompressed size,
 * the total uncompressed size, and the ratio of that total to the zip's own size.
 *
 * The scan reads the zip the way `unzip` will: the whole central directory (its byte range, not
 * the entry count the end record claims, which `unzip` does not stop at), which must sit right
 * before the end record so no offset is shifted, and each entry's local header, whose sizes must
 * agree with the central one. The sizes are still what the zip declares; `verifyZipMembers`
 * (`marketplace-zip-inflate.ts`) holds each entry to them.
 */

export interface ZipLimits {
  maxEntries: number
  maxFileBytes: number
  maxTotalBytes: number
  maxRatio: number
}

const MiB = 1024 * 1024

export const ZIP_LIMITS: ZipLimits = {
  maxEntries: 100_000,
  maxFileBytes: 512 * MiB,
  maxTotalBytes: 1024 * MiB,
  maxRatio: 50,
}

const EOCD = 0x06054b50
const ZIP64_LOCATOR = 0x07064b50
const ZIP64_EOCD = 0x06064b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const U16_MAX = 0xffff
const U32_MAX = 0xffffffff
const STORED = 0
const DEFLATED = 8

/** One file as `unzip` will read it: where its data starts and what it declares. */
export interface ZipMember {
  name: string
  method: typeof STORED | typeof DEFLATED
  dataStart: number
  compressedBytes: number
  bytes: number
}

export interface ZipSummary {
  entries: number
  totalBytes: number
  largestBytes: number
  members: ZipMember[]
}

function bad(message: string): UnprocessableError {
  return new UnprocessableError('plugin_archive_invalid', message)
}

function tooLarge(message: string): UnprocessableError {
  return new UnprocessableError('plugin_archive_too_large', message)
}

function u64(buf: Buffer, at: number): number {
  return Number(buf.readBigUInt64LE(at))
}

/** Offset of the end-of-central-directory record, searched back over the longest comment. */
function findEnd(buf: Buffer): number {
  const stop = Math.max(0, buf.length - 22 - U16_MAX)
  for (let at = buf.length - 22; at >= stop; at--) if (buf.readUInt32LE(at) === EOCD) return at
  throw bad('Archive is not a zip file (no end of central directory)')
}

interface Directory {
  count: number
  size: number
  offset: number
  /** Where the central directory must end: the ZIP64 end record, or the classic one. */
  endsAt: number
}

/** The central directory, from the ZIP64 record when the zip has one. */
function directoryOf(buf: Buffer, end: number): Directory {
  const classic = {
    count: buf.readUInt16LE(end + 10),
    size: buf.readUInt32LE(end + 12),
    offset: buf.readUInt32LE(end + 16),
  }
  const locator = end - 20
  if (locator < 0 || buf.readUInt32LE(locator) !== ZIP64_LOCATOR) {
    if (classic.count === U16_MAX || classic.offset === U32_MAX || classic.size === U32_MAX)
      throw bad('Archive is a ZIP64 file without its locator')
    return { ...classic, endsAt: end }
  }
  const record = u64(buf, locator + 8)
  if (record + 56 > locator || buf.readUInt32LE(record) !== ZIP64_EOCD)
    throw bad('Archive has a broken ZIP64 end record')
  const wide = {
    count: u64(buf, record + 32),
    size: u64(buf, record + 40),
    offset: u64(buf, record + 48),
  }
  // A classic field that is not full must say what the ZIP64 record says.
  const agrees =
    (classic.count === U16_MAX || classic.count === wide.count) &&
    (classic.size === U32_MAX || classic.size === wide.size) &&
    (classic.offset === U32_MAX || classic.offset === wide.offset)
  if (!agrees) throw bad('Archive end records disagree about the central directory')
  return { ...wide, endsAt: record }
}

/** Resolve the `full` (0xFFFFFFFF) fields, in order, from a ZIP64 extended-information field. */
function zip64Values(buf: Buffer, start: number, end: number, fields: number[]): number[] {
  const full = fields.filter((value) => value === U32_MAX).length
  if (full === 0) return fields
  for (let p = start; p + 4 <= end;) {
    const id = buf.readUInt16LE(p)
    const len = buf.readUInt16LE(p + 2)
    if (id === 0x0001 && len >= 8 * full && p + 4 + 8 * full <= end) {
      let next = p + 4
      return fields.map((value) => {
        if (value !== U32_MAX) return value
        const wide = u64(buf, next)
        next += 8
        return wide
      })
    }
    p += 4 + len
  }
  throw bad('Archive entry declares a ZIP64 size without its extra field')
}

/** Read the central header at `at` and the local header it points to. */
function memberAt(buf: Buffer, at: number, dir: Directory): { member: ZipMember; next: number } {
  if (at + 46 > dir.offset + dir.size || buf.readUInt32LE(at) !== CENTRAL)
    throw bad('Archive central directory is truncated or corrupt')
  const flags = buf.readUInt16LE(at + 8)
  const method = buf.readUInt16LE(at + 10)
  const nameLen = buf.readUInt16LE(at + 28)
  const extraLen = buf.readUInt16LE(at + 30)
  const extraStart = at + 46 + nameLen
  const next = extraStart + extraLen + buf.readUInt16LE(at + 32)
  if (next > dir.offset + dir.size) throw bad('Archive central directory is truncated or corrupt')
  const name = buf.toString('utf8', at + 46, extraStart)
  const raw = [buf.readUInt32LE(at + 24), buf.readUInt32LE(at + 20), buf.readUInt32LE(at + 42)]
  const [bytes, compressedBytes, local] = zip64Values(buf, extraStart, extraStart + extraLen, raw)
  if (flags & 1) throw bad(`Archive entry ${name} is encrypted`)
  if (method !== STORED && method !== DEFLATED)
    throw bad(`Archive entry ${name} uses compression method ${method} (stored or deflate only)`)
  if (method === STORED && compressedBytes !== bytes)
    throw bad(`Archive entry ${name} is stored with two different sizes`)

  if (local + 30 > dir.offset || buf.readUInt32LE(local) !== LOCAL)
    throw bad(`Archive entry ${name} has no local header`)
  const localFlags = buf.readUInt16LE(local + 6)
  const localExtraStart = local + 30 + buf.readUInt16LE(local + 26)
  const dataStart = localExtraStart + buf.readUInt16LE(local + 28)
  if (buf.readUInt16LE(local + 8) !== method || (localFlags & 1) !== 0)
    throw bad(`Archive entry ${name} has a local header that disagrees with the directory`)
  // Without a data descriptor (bit 3) `unzip` trusts the local sizes, so they must match.
  if (!(localFlags & 8)) {
    const localRaw = [buf.readUInt32LE(local + 22), buf.readUInt32LE(local + 18)]
    const [localBytes, localCompressed] = zip64Values(buf, localExtraStart, dataStart, localRaw)
    if (localBytes !== bytes || localCompressed !== compressedBytes)
      throw bad(`Archive entry ${name} has a local header that disagrees with the directory`)
  }
  if (dataStart + compressedBytes > dir.offset)
    throw bad(`Archive entry ${name} runs past the end of the file data`)
  return { member: { name, method, dataStart, compressedBytes, bytes }, next }
}

/** Walk the whole central directory, refusing the archive past `limits`. */
export function scanZip(buf: Buffer, limits: ZipLimits = ZIP_LIMITS): ZipSummary {
  const end = findEnd(buf)
  const dir = directoryOf(buf, end)
  if (dir.count > limits.maxEntries)
    throw tooLarge(`Archive has ${dir.count} entries (limit ${limits.maxEntries})`)
  if (dir.offset + dir.size !== dir.endsAt)
    throw bad('Archive central directory does not end where the end record starts')
  const members: ZipMember[] = []
  let totalBytes = 0
  let largestBytes = 0
  for (let at = dir.offset; at < dir.endsAt;) {
    const { member, next } = memberAt(buf, at, dir)
    members.push(member)
    if (members.length > limits.maxEntries)
      throw tooLarge(`Archive has more than ${limits.maxEntries} entries`)
    totalBytes += member.bytes
    largestBytes = Math.max(largestBytes, member.bytes)
    if (member.bytes > limits.maxFileBytes)
      throw tooLarge(`Archive has a file of ${member.bytes} bytes (limit ${limits.maxFileBytes})`)
    if (totalBytes > limits.maxTotalBytes)
      throw tooLarge(`Archive unpacks to more than ${limits.maxTotalBytes} bytes`)
    at = next
  }
  if (members.length !== dir.count)
    throw bad(
      `Archive end record counts ${dir.count} entries; its directory holds ${members.length}`,
    )
  if (totalBytes > buf.length * limits.maxRatio)
    throw tooLarge(
      `Archive unpacks to ${totalBytes} bytes, more than ${limits.maxRatio} times its ${buf.length}-byte size`,
    )
  return { entries: members.length, totalBytes, largestBytes, members }
}
