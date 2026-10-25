import { localixResourceUri, localixUiUri, parseLocalixUri } from './grammar'
import { settingsUiUri } from './surfaces'

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
