import { localixResourceUri } from '../navigation'
import { parseLocalixResourceUri } from '../resource'

export interface ResourceNavTarget {
  parent: string | null
  segment: string
  provider: string | null
}

/** Parsed shape of `localix://resource/<provider>/<a>/<b>/<c>`. Pure. */
export interface ParsedResourceUri {
  /** Provider dispatch key. */
  provider: string
  /** Encoded identity path after the provider segment. */
  rest: string
  /** `rest` split on `/`, empty trailing segments dropped. */
  segments: string[]
}

/** Canonical `@resource:` drill math, shared by registries and presentation helpers. */
export function resourceNav(partial: string): ResourceNavTarget {
  if (partial === '') return { parent: null, segment: '', provider: null }
  if (partial.includes('?') || partial.includes('#')) {
    return { parent: null, segment: partial, provider: null }
  }
  const trailingSlash = partial.endsWith('/')
  const identity = trailingSlash ? partial.slice(0, -1) : partial
  // A picker partial may have one trailing slash to mean "list this container";
  // canonical resource identities themselves never contain empty path segments.
  if (!identity || identity.endsWith('/')) {
    return { parent: null, segment: partial, provider: null }
  }
  const parsed = parseResourceUri(identity)
  if (!parsed) return { parent: null, segment: partial, provider: null }
  const providerRoot = buildResourceUri(parsed.provider)
  const rest = parsed.rest
  if (rest === '') return { parent: null, segment: '', provider: parsed.provider }
  if (trailingSlash) {
    return {
      parent: `${providerRoot}/${rest.replace(/\/+$/, '')}`,
      segment: '',
      provider: parsed.provider,
    }
  }
  const lastSlash = rest.lastIndexOf('/')
  if (lastSlash === -1) return { parent: null, segment: rest, provider: parsed.provider }
  return {
    parent: `${providerRoot}/${rest.slice(0, lastSlash)}`,
    segment: rest.slice(lastSlash + 1),
    provider: parsed.provider,
  }
}

/** Canonical partial inserted when opening a resource node. */
export function resourceDrillPartial(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`
}

/** Build a canonical provider resource URI from raw, unescaped identity segments. */
export function buildResourceUri(provider: string, segments: readonly string[] = []): string {
  return localixResourceUri(provider, segments)
}

/** Splits a canonical resource URI into provider + encoded path segments. */
export function parseResourceUri(uri: string): ParsedResourceUri | null {
  const parsed = parseLocalixResourceUri(uri)
  if (!parsed) return null
  const rest = parsed.segments.join('/')
  return {
    provider: parsed.provider,
    rest,
    segments: parsed.segments,
  }
}

/** Canonical one-level-up navigation for both composer pickers. An empty string
 * means the provider-category root (`@resource:`). */
export function resourceParentPartial(partial: string): string {
  const normalized = partial.trim()
  if (!normalized) return ''
  const nav = resourceNav(normalized)

  // First clear an in-progress search segment without leaving its container.
  if (nav.segment) {
    if (nav.parent) return `${nav.parent}/`
    return nav.provider ? `${buildResourceUri(nav.provider)}/` : ''
  }
  // A provider root's parent is the category list.
  if (!nav.parent) return ''

  const parsed = parseResourceUri(nav.parent)
  if (!parsed) return ''
  const root = buildResourceUri(parsed.provider)
  if (parsed.segments.length <= 1) return `${root}/`
  return `${root}/${parsed.segments.slice(0, -1).join('/')}/`
}

/**
 * Percent-encodes ONE path segment when minting a resource URI. RFC3986-strict
 * encoding protects whitespace, separators, and trailing punctuation from both
 * positional splitting and the composer's token grammar.
 */
const pctEncode = (character: string): string =>
  `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`

export const encodeResourceSegment = (segment: string): string =>
  encodeURIComponent(segment)
    .replace(/[!'()*]/g, pctEncode)
    .replace(/\.+$/, (run) => pctEncode('.').repeat(run.length))

/** Decodes a segment minted by {@link encodeResourceSegment}. Guarded: malformed
 * percent-input (or a drag-minted unencoded name) is returned verbatim. */
export function decodeResourceSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/**
 * Parse `uri` and return its segments only when it belongs to `provider`.
 * Providers use this guard at the top of `listChildren` and `expand`.
 */
export function providerSegments(provider: string, uri: string): string[] | null {
  const parsed = parseResourceUri(uri)
  return parsed?.provider === provider ? parsed.segments : null
}
