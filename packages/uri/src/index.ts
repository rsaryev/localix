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

/** Canonical in-app destination for a file shown by the workbench inspector. */
export function fileUiUri(input: { path: string; line?: number }): string {
  const line = Number.isSafeInteger(input.line) && input.line! > 0 ? String(input.line) : undefined
  return localixUiUri('work-item', ['file'], { path: input.path, line })
}

/** Markdown affordance a tool can hand the model verbatim for its final response. */
export function fileOpenMarkdownLink(path: string, title?: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean)
  const fileName = segments.length > 0 ? segments[segments.length - 1]! : path
  const label = (title?.trim() || fileName).replace(/[\\[\]]/g, '\\$&')
  return `[${label}](${fileUiUri({ path })})`
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

/** Canonical settings surface URI shared by backend search and frontend navigation. */
export function settingsUiUri(
  tab?: string,
  options: { anchor?: string; entryId?: string; scope?: string } = {},
): string {
  return localixUiUri(
    'settings',
    [
      tab ?? 'root',
      ...(options.anchor ? [options.anchor] : []),
      ...(options.entryId ? [options.entryId] : []),
    ],
    { scope: options.scope },
  )
}

/** Stable element id for one entity row inside a registry-like settings tab. */
export function settingsEntityAnchor(entity: string, id: string): string {
  return `${entity}-${id}`
}

/** Canonical exact-scope link to an entity row inside Settings. */
export function settingsEntityUiUri(tab: string, entity: string, id: string, scope = ''): string {
  return settingsUiUri(tab, {
    anchor: settingsEntityAnchor(entity, id),
    scope,
  })
}

export type CapabilityResourceKind =
  | 'plugin'
  | 'mini-app'
  | 'skill'
  | 'tool'
  | 'agent'
  | 'mcp'
  | 'view'

export interface CapabilityResource {
  kind: CapabilityResourceKind
  id: string
  scope: string
  label?: string
  description?: string
  enabled?: boolean
}

const CAPABILITY_KINDS = new Set<CapabilityResourceKind>([
  'plugin',
  'mini-app',
  'skill',
  'tool',
  'agent',
  'mcp',
  'view',
])

/** Stable resource URI carried by capability drag bindings. It contains only
 * compact, non-secret presentation facts captured at drag time. */
export function capabilityResourceUri(resource: CapabilityResource): string {
  return localixResourceUri('capability', [resource.kind, resource.id], {
    scope: resource.scope,
    label: resource.label?.slice(0, 160) || undefined,
    description: resource.description?.slice(0, 400) || undefined,
    enabled: resource.enabled === undefined ? undefined : resource.enabled ? '1' : '0',
  })
}

/** Parse and validate a capability resource URI at the UI/backend boundary. */
export function parseCapabilityResourceUri(uri: string): CapabilityResource | null {
  const parsed = parseLocalixUri(uri)
  if (parsed?.primitive !== 'resource' || parsed.breadcrumbs.length !== 3) return null
  const [provider, rawKind, id] = parsed.breadcrumbs
  if (provider !== 'capability') return null
  const kind = rawKind as CapabilityResourceKind
  if (!CAPABILITY_KINDS.has(kind)) return null
  const allowedQuery = new Set(['scope', 'label', 'description', 'enabled'])
  const seenQuery = new Set<string>()
  for (const [key] of parsed.query) {
    if (!allowedQuery.has(key) || seenQuery.has(key)) return null
    seenQuery.add(key)
  }
  const scope = parsed.query.get('scope') ?? ''
  const label = parsed.query.get('label')
  const description = parsed.query.get('description')
  const enabled = parsed.query.get('enabled')
  if (
    scope.length > 512 ||
    (label !== null && (!label || label.length > 160)) ||
    (description !== null && (!description || description.length > 400)) ||
    (enabled !== null && enabled !== '1' && enabled !== '0')
  )
    return null
  return {
    kind,
    id,
    scope,
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    ...(enabled === '1' || enabled === '0' ? { enabled: enabled === '1' } : {}),
  }
}

/**
 * Where a capability resource is managed: its page in the Store, in the scope it lives in. A
 * plugin the caller knows by name alone (no `@marketplace`) opens the Plugins shelf, a screen opens
 * its mini app, and a tool, which no package owns, is decided in Settings → Permissions.
 */
export function capabilityUiUri(resource: CapabilityResource): string {
  const store = (kind: string, id?: string) => localixUiUri('work-item', ['store'], { kind, id })
  const project = resource.scope !== ''
  switch (resource.kind) {
    case 'plugin':
      return store('plugin', resource.id.includes('@') ? resource.id : undefined)
    case 'mini-app':
      return store('mini-app', resource.id)
    // A view is one of a mini app's screens: it is managed with the mini app.
    case 'view':
      return store('mini-app', resource.id.split(':')[0])
    case 'skill':
      return store('skill', `${project ? 'project' : 'user'}:${resource.id}`)
    case 'mcp':
      return store('mcp-server', project ? `project:${resource.id}` : resource.id)
    case 'agent':
      return store('agent', resource.id)
    case 'tool':
      return settingsUiUri('permissions', { scope: resource.scope })
  }
}
