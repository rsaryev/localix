export type LocalixUriPrimitive = 'ui' | 'resource'
export type LocalixUiPrimitive =
  | 'page'
  | 'sidebar'
  | 'work-item'
  | 'overlay'
  | 'picker'
  | 'settings'
  | 'mini-app'
  | 'command'
  | 'action'

export const LOCALIX_UI_PRIMITIVES: ReadonlySet<string> = new Set<LocalixUiPrimitive>([
  'page',
  'sidebar',
  'work-item',
  'overlay',
  'picker',
  'settings',
  'mini-app',
  'command',
  'action',
])

export function isLocalixUiPrimitive(value: string): value is LocalixUiPrimitive {
  return LOCALIX_UI_PRIMITIVES.has(value)
}

export interface ParsedLocalixUri {
  primitive: LocalixUriPrimitive
  /** Decoded, ordered identity breadcrumbs after the primitive authority. */
  breadcrumbs: string[]
  query: URLSearchParams
}

/** One canonical URI size limit shared by parsers, registries, and agent tooling. */
export const LOCALIX_URI_MAX_CHARS = 4_096
const LOCALIX_BREADCRUMB_LIMIT = 16
const LOCALIX_BREADCRUMB_MAX_CHARS = 512
const LOCALIX_PROVIDER = /^[a-z][a-z0-9._-]{0,63}$/

/** Strict parser shared by UI intents and provider resources. */
export function parseLocalixUri(value: string): ParsedLocalixUri | null {
  if (!value || value.length > LOCALIX_URI_MAX_CHARS) return null
  try {
    const parsed = new URL(value)
    // `localix:` is a NON-SPECIAL scheme, so its host is OPAQUE: `URL` does not lowercase it
    // the way it would an `http:` host. That is what makes this plain equality the authority's
    // case check — `localix://RESOURCE/x` has hostname `'RESOURCE'` and is rejected here.
    if (
      parsed.protocol !== 'localix:' ||
      (parsed.hostname !== 'ui' && parsed.hostname !== 'resource') ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.hash
    ) {
      return null
    }
    // URL normalizes literal and percent-encoded dot segments before exposing
    // `pathname`. Reject them from the original spelling so a crafted identity
    // cannot silently address a different resource.
    const authority = `localix://${parsed.hostname}`
    if (!value.startsWith(authority)) return null
    const rawPath = value.slice(authority.length).split(/[?#]/, 1)[0]
    if (!/^\/[^/]+(?:\/[^/]+)*$/.test(rawPath)) return null
    const rawSegments = rawPath.slice(1).split('/')
    if (
      rawSegments.some((segment) => {
        const decoded = decodeURIComponent(segment)
        return decoded === '.' || decoded === '..'
      })
    ) {
      return null
    }
    // No `length === 0` check: `''.split('/')` yields `['']`, so this array is never empty —
    // the emptiness that matters is a blank SEGMENT, rejected two lines down.
    const encoded = parsed.pathname.slice(1).split('/')
    if (encoded.length > LOCALIX_BREADCRUMB_LIMIT) return null
    const breadcrumbs = encoded.map((segment) => decodeURIComponent(segment))
    if (breadcrumbs.some((segment) => !segment || segment.length > LOCALIX_BREADCRUMB_MAX_CHARS))
      return null
    if (parsed.hostname === 'resource' && !LOCALIX_PROVIDER.test(breadcrumbs[0]!)) return null
    if (
      parsed.hostname === 'ui' &&
      (breadcrumbs.length < 2 || !isLocalixUiPrimitive(breadcrumbs[0]!))
    ) {
      return null
    }
    return {
      primitive: parsed.hostname,
      breadcrumbs,
      query: parsed.searchParams,
    }
  } catch {
    return null
  }
}

/** Build one URI in the canonical Localix namespace. */
export function localixUri(
  primitive: LocalixUriPrimitive,
  segments: readonly string[] = [],
  query?: Readonly<Record<string, string | undefined>>,
): string {
  if (
    segments.length === 0 ||
    segments.length > LOCALIX_BREADCRUMB_LIMIT ||
    segments.some(
      (segment) =>
        typeof segment !== 'string' ||
        !segment ||
        segment.length > LOCALIX_BREADCRUMB_MAX_CHARS ||
        segment === '.' ||
        segment === '..',
    )
  ) {
    throw new TypeError('Localix URI breadcrumbs must be non-empty, bounded identity segments')
  }
  if (primitive === 'resource' && !LOCALIX_PROVIDER.test(segments[0]!)) {
    throw new TypeError(`Invalid Localix resource provider: ${segments[0]}`)
  }
  if (primitive === 'ui' && (segments.length < 2 || !isLocalixUiPrimitive(segments[0]!))) {
    throw new TypeError('Localix UI URIs require a known surface and owner segment')
  }
  const path = segments.map((segment) => encodeURIComponent(segment)).join('/')
  const base = `localix://${primitive}/${path}`
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, value)
  }
  const suffix = params.toString()
  const uri = suffix ? `${base}?${suffix}` : base
  if (uri.length > LOCALIX_URI_MAX_CHARS) {
    throw new TypeError(`Localix URI exceeds ${LOCALIX_URI_MAX_CHARS} characters`)
  }
  return uri
}

/** Build a typed UI intent URI: `localix://ui/<surface>/<owner...>`. */
export function localixUiUri(
  surface: LocalixUiPrimitive,
  segments: readonly string[],
  query?: Readonly<Record<string, string | undefined>>,
): string {
  return localixUri('ui', [surface, ...segments], query)
}

/** Build a provider resource URI: `localix://resource/<provider>/<identity...>`. */
export function localixResourceUri(
  provider: string,
  segments: readonly string[] = [],
  query?: Readonly<Record<string, string | undefined>>,
): string {
  if (!LOCALIX_PROVIDER.test(provider)) {
    throw new TypeError(`Invalid Localix resource provider: ${provider}`)
  }
  return localixUri('resource', [provider, ...segments], query)
}
