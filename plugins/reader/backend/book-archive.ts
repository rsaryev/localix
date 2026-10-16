import { posix } from 'node:path'
import { isAtOrUnder } from '@localixai/path-containment'
import { mediaTypeForPath } from '@localixai/plugin-sdk/backend'
import { strFromU8, unzipSync } from 'fflate'

/** Virtual root every archive-internal entry name is resolved inside. */
const ARCHIVE_ROOT = '/__archive__'
export const MAX_SOURCE_BYTES = 64 * 1024 * 1024
const MAX_EPUB_ENTRIES = 3_000
const MAX_EPUB_UNCOMPRESSED_BYTES = 160 * 1024 * 1024

export function decoded(bytes: Uint8Array | undefined): string {
  return bytes ? strFromU8(bytes) : ''
}

export function archivePath(from: string, href: string): string | null {
  const clean = href.split('#', 1)[0]?.split('?', 1)[0]
  if (!clean) return null
  let decodedHref = clean
  try {
    decodedHref = decodeURIComponent(clean)
  } catch {
    // Keep the literal archive name when the EPUB contains malformed percent escapes.
  }
  const target = posix.normalize(posix.join(posix.dirname(from), decodedHref)).replace(/^\/+/, '')
  // Archive entries are named relative to a virtual root, so containment is the same
  // ancestry question the filesystem asks — answered by the owner, not by a `..` sniff.
  return isAtOrUnder(ARCHIVE_ROOT, posix.join(ARCHIVE_ROOT, target), '/') ? target : null
}

/** The raster formats the reader renders from a book archive (never a scriptable SVG). */
const READER_IMAGE_TYPES = new Set([
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
])

export function imageMime(path: string): string | null {
  return safeImageMime(mediaTypeForPath(path) ?? '')
}

export function safeImageMime(value: string): string | null {
  const normalized = value.trim().toLowerCase()
  return READER_IMAGE_TYPES.has(normalized) ? normalized : null
}

/**
 * `unzipSync`, with its own words kept out of the reading pane.
 *
 * fflate answers a truncated or non-zip file with `invalid zip data` / `unexpected EOF` — true, and
 * not a sentence anyone should meet as the reason their book will not open. The bounds thrown from
 * inside the filter below ARE ours and stand as they are; anything else becomes one sentence with
 * the library's text as the cause, which the router forwards as `detail`.
 */
function readArchive(
  bytes: Uint8Array,
  label: string,
  options: Parameters<typeof unzipSync>[1],
): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes, options)
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith(label)) throw cause
    throw new Error(`This ${label} is not a readable archive.`, { cause })
  }
}

export function unzipBounded(bytes: Uint8Array, label: string): Record<string, Uint8Array> {
  let acceptedEntries = 0
  let acceptedBytes = 0
  const files = readArchive(bytes, label, {
    filter(entry) {
      if (entry.name.startsWith('__MACOSX/')) return false
      acceptedEntries += 1
      acceptedBytes += entry.originalSize
      if (acceptedEntries > MAX_EPUB_ENTRIES)
        throw new Error(`${label} has too many archive entries`)
      if (acceptedBytes > MAX_EPUB_UNCOMPRESSED_BYTES) {
        throw new Error(`${label} expands beyond the limit`)
      }
      return entry.originalSize <= MAX_SOURCE_BYTES
    },
  })
  const entries = Object.entries(files)
  if (entries.length > MAX_EPUB_ENTRIES) throw new Error(`${label} has too many archive entries`)
  const uncompressed = entries.reduce((sum, [, value]) => sum + value.byteLength, 0)
  if (uncompressed > MAX_EPUB_UNCOMPRESSED_BYTES) {
    throw new Error(`${label} expands beyond the limit`)
  }
  return files
}

export function xmlText(document: Document, names: string[]): string | undefined {
  for (const name of names) {
    const value = document.getElementsByTagName(name)[0]?.textContent?.trim()
    if (value) return value
  }
  return undefined
}
