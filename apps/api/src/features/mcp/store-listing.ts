import type { Listing, ListingDetail, Scope } from '@localixai/store'

import type { McpServerRecord } from './repository'

/**
 * AN MCP SERVER AS A LISTING (`docs/internals/store.md`). Three kinds of server share the kind
 * and tell apart by id, which is stable across a recreation because it is built from the name:
 *
 *   `<name>`                 one the person added, for themselves
 *   `project:<name>`         one the person added for a project
 *   `file:<scope>:<name>`    one Claude Code's own files define (`claude-code-servers.ts`)
 *
 * A server of a plugin is not here: it is a component of the plugin and follows it
 * (`docs/internals/store.md`, "MCP servers").
 */
export type ServerRef =
  | { origin: 'own'; scope: Scope; name: string }
  | { origin: 'file'; scope: string; name: string }

export function refOf(id: string): ServerRef | null {
  if (id.startsWith('file:')) {
    const [, scope, ...rest] = id.split(':')
    const name = rest.join(':')
    return scope && name ? { origin: 'file', scope, name } : null
  }
  if (id.startsWith('project:')) return { origin: 'own', scope: 'project', name: id.slice(8) }
  return id ? { origin: 'own', scope: 'user', name: id } : null
}

/** Whether it belongs to a project: a project's own, or a file's `.mcp.json` or local entry. */
export const inProject = (ref: ServerRef): boolean =>
  ref.origin === 'own' ? ref.scope === 'project' : ref.scope === 'project' || ref.scope === 'local'

export const idOf = (ref: ServerRef): string =>
  ref.origin === 'file'
    ? `file:${ref.scope}:${ref.name}`
    : ref.scope === 'project'
      ? `project:${ref.name}`
      : ref.name

/** Where Claude Code keeps a scope's servers, as the page names it. */
const FILES: Record<string, string> = {
  user: '~/.claude.json',
  local: '~/.claude.json',
  project: '.mcp.json',
  managed: 'the organization’s managed settings',
}
export const fileOf = (scope: string): string => FILES[scope] ?? 'a Claude Code file'

const TRANSPORTS = {
  stdio: 'Runs on this computer',
  http: 'Connects over HTTP',
  ws: 'Connects by web socket',
}

export function serverListing(
  record: McpServerRecord,
  at: { ref: ServerRef; enabled: boolean },
): Listing {
  const file = at.ref.origin === 'file'
  const project = inProject(at.ref)
  return {
    ref: { kind: 'mcp-server', id: idOf(at.ref) },
    name: record.name,
    displayName: record.name,
    summary: record.description || TRANSPORTS[record.transport],
    tags: [record.transport],
    publisher: { name: file ? 'Claude Code' : 'You', verified: false },
    source: file
      ? { id: 'mcp:claude-code', label: 'Claude Code files' }
      : {
          id: project ? 'mcp:project' : 'mcp:yours',
          label: project ? 'This project' : 'Your servers',
        },
    contents: { 'mcp-server': 1 },
    runsCode: record.transport === 'stdio',
    featured: false,
    recommended: false,
    installs: [{ scope: project ? 'project' : 'user', enabled: at.enabled }],
    authored: project ? 'project' : 'user',
    ...(file ? {} : { configurable: true }),
  }
}

/** The page of one: how it connects, never what it holds (a URL or argument may carry a token). */
export function serverDetail(
  listing: Listing,
  record: McpServerRecord,
  ref: ServerRef,
): ListingDetail {
  const host = typeof record.config.url === 'string' ? hostOf(record.config.url) : null
  const program = Array.isArray(record.config.command) ? String(record.config.command[0] ?? '') : ''
  const facts: [string, string | undefined][] = [
    ['Connects by', TRANSPORTS[record.transport]],
    ['Program', program || undefined],
    ['Host', host ?? undefined],
    ...(ref.origin === 'file' ? [['Defined in', fileOf(ref.scope)] as [string, string]] : []),
  ]
  return {
    ...listing,
    readme: null,
    media: [],
    facts: facts.flatMap(([label, value]) => (value ? [{ label, value }] : [])),
    components: [{ kind: 'mcp-server', name: record.name }],
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
