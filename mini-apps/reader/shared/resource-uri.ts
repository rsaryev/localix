import { READER_PROVIDER, type ReaderSource } from './contracts'

const ROOT = `localix://resource/${READER_PROVIDER}`
const MAX_SOURCE_SEGMENT_CHARS = 2_048

export type ReaderResource =
  | { kind: 'root' }
  | { kind: 'book'; source: ReaderSource }
  | { kind: 'chapter'; source: ReaderSource; chapter: number }

export function readerRootUri(): string {
  return ROOT
}

function normalizeSource(source: string | ReaderSource): ReaderSource {
  return typeof source === 'string' ? { path: source } : source
}

/**
 * A book is one opaque identity segment directly below the Reader provider.
 * Keeping the source out of query parameters is load-bearing: the shared Localix
 * resource browser can now walk Reader → book → chapter and build native breadcrumbs.
 */
function encodeSource(source: string | ReaderSource): string {
  const normalized = normalizeSource(source)
  const serialized = JSON.stringify(
    'path' in normalized
      ? { path: normalized.path }
      : {
          mediaId: normalized.mediaId,
          ...(normalized.name ? { name: normalized.name } : {}),
        },
  )
  if (serialized.length > MAX_SOURCE_SEGMENT_CHARS) {
    throw new TypeError('Reader source identity is too large')
  }
  return encodeURIComponent(serialized)
}

function decodeSource(segment: string): ReaderSource | null {
  try {
    const value: unknown = JSON.parse(decodeURIComponent(segment))
    if (!value || typeof value !== 'object') return null
    const source = value as Record<string, unknown>
    const keys = Object.keys(source)
    if (
      keys.length === 1 &&
      typeof source.path === 'string' &&
      source.path.trim() &&
      source.path.length <= 4_096
    ) {
      return { path: source.path }
    }
    if (
      (keys.length === 1 || (keys.length === 2 && keys.includes('name'))) &&
      typeof source.mediaId === 'string' &&
      source.mediaId.trim() &&
      source.mediaId.length <= 512 &&
      (source.name === undefined ||
        (typeof source.name === 'string' && source.name.trim() && source.name.length <= 512))
    ) {
      return {
        mediaId: source.mediaId,
        ...(typeof source.name === 'string' ? { name: source.name } : {}),
      }
    }
  } catch {
    // A malformed identity is not a source.
  }
  return null
}

export function readerBookUri(source: string | ReaderSource): string {
  return `${readerRootUri()}/${encodeSource(source)}`
}

export function readerChapterUri(source: string | ReaderSource, chapter: number): string {
  if (!Number.isSafeInteger(chapter) || chapter < 0) throw new TypeError('Invalid Reader chapter')
  return `${readerBookUri(source)}/${chapter}`
}

export function parseReaderUri(uri: string): ReaderResource | null {
  if (uri === ROOT) return { kind: 'root' }
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    return null
  }
  if (parsed.protocol !== 'localix:' || parsed.host !== 'resource' || parsed.hash) return null
  const segments = parsed.pathname.split('/').filter(Boolean)
  if (segments[0] !== READER_PROVIDER) return null
  if (parsed.search) return null
  if (segments.length !== 2 && segments.length !== 3) return null
  const source = decodeSource(segments[1]!)
  if (!source) return null
  if (segments.length === 2) return { kind: 'book', source }
  const chapter = Number(segments[2])
  return Number.isSafeInteger(chapter) && chapter >= 0 ? { kind: 'chapter', source, chapter } : null
}
