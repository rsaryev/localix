import { LOCALIX_URI_MAX_CHARS, localixUiUri, parseLocalixUri } from '../navigation'
import type { UiSurfaceKind } from './locations'

const UI_MUTATION_SEGMENT = /^[a-z0-9][a-z0-9._~-]{0,63}$/

export const UI_LOCATION_QUERY_ENTRY_LIMIT = 16
export const UI_LOCATION_DEFAULT_STRING_MAX = 512
export const UI_LOCATION_DEFAULT_ARRAY_MAX = 8
export const UI_AGENT_LOCATION_CATALOG_LIMIT = 128

export const UI_SURFACE_KINDS: ReadonlySet<string> = new Set<UiSurfaceKind>([
  'page',
  'sidebar',
  'work-item',
  'overlay',
  'picker',
  'settings',
  'plugin',
  'command',
  'action',
])

export function containsAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

/** Locale-independent ordering for wire normalization and content identity. */
export function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export const UI_AGENT_LOCATION_CATALOG_VERSION = 1 as const

export function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Exact base URI normalization used by contribution and wire validation. */
export function normalizeUiLocationBaseUri(value: string, surface: UiSurfaceKind): string | null {
  if (!value || value.length > LOCALIX_URI_MAX_CHARS) return null
  const localix = parseLocalixUri(value)
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (
    localix?.primitive !== 'ui' ||
    localix.breadcrumbs.length < 2 ||
    localix.breadcrumbs[0] !== surface ||
    Array.from(localix.query).length > 0 ||
    parsed.search !== '' ||
    parsed.hash !== ''
  ) {
    return null
  }
  const canonicalPath = localixUiUri(surface, localix.breadcrumbs.slice(1))
  return canonicalPath
}

export function isValidUiMutationBaseUri(value: string): boolean {
  const parsed = parseLocalixUri(value)
  const segments = parsed?.primitive === 'ui' ? parsed.breadcrumbs : []
  return (
    segments.length === 3 &&
    segments[0] === 'action' &&
    segments.slice(1).every((segment) => UI_MUTATION_SEGMENT.test(segment))
  )
}
