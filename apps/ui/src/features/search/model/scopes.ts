/**
 * Search scopes use filter atoms. Each scope maps to a backend domain (provider id)
 * OR a client-only navigation domain (settings/commands). A scope narrows the query;
 * the empty pseudo-scope (`all`) searches every eager domain.
 *
 * Typed prefixes (`db:foo`, `f:store`) auto-promote into the active scope so typed
 * filters and picker selections use the same scope state. Only KNOWN prefixes activate
 * a scope — an unknown `word:foo` stays a literal query. Pure + unit-tested; icon keys
 * map to glyphs in the UI.
 *
 * Core names only the always-present domains here. A bundled subsystem contributes its
 * own scope atom from its `contrib` via the open search-domain registry (see
 * `shared/contrib/searchDomains.ts`), so this slice never hardcodes an individual
 * subsystem — `allScopes()` fuses the base list with the contributed atoms.
 */

import { searchDomainScopes } from '@/shared/contrib/searchDomains'
import { useMiniAppRegistrySlice } from '@/shared/contrib/useMiniAppRegistrySlice'

export interface ScopeDef {
  /** Backend provider id / client domain — the `domains` value sent to the endpoint. */
  id: string
  /** Chip + dropdown label. */
  label: string
  /** Typed prefix (without the colon) that promotes into this scope. */
  prefix: string
  /** Extra prefixes that also select it. */
  aliases?: string[]
  /** Glyph key (mapped to a lucide icon by the surface). */
  icon: string
  /** Placeholder shown when the scope is active. */
  placeholder?: string
  /** Client-only navigation domain (merged in the UI, never sent to the endpoint). */
  clientOnly?: boolean
  /** Heavy domain that only runs when explicitly scoped (documented for the picker). */
  lazy?: boolean
}

/** The "search everything" pseudo-scope — no domain filter. */
export const ALL_SCOPE: ScopeDef = {
  id: 'all',
  label: 'All',
  prefix: '',
  icon: 'search',
  placeholder: 'Search everything…',
}

/**
 * The always-present core scopes, in picker order. Ids MUST match the backend
 * `SearchProvider` ids (plus the two client-only domains). Subsystem scopes
 * (containers, clusters, …) are appended by `allScopes()` from the registry.
 */
export const BASE_SCOPES: ScopeDef[] = [
  {
    id: 'projects',
    label: 'Projects',
    prefix: 'proj',
    aliases: ['project'],
    icon: 'project',
    placeholder: 'Search projects…',
  },
  {
    id: 'sessions',
    label: 'Chats',
    prefix: 'chat',
    aliases: ['chats', 'session'],
    icon: 'session',
    placeholder: 'Search chats…',
  },
  {
    id: 'messages',
    label: 'Messages',
    prefix: 'msg',
    aliases: ['message'],
    icon: 'message',
    placeholder: 'Search messages…',
  },
  {
    id: 'files',
    label: 'Files',
    prefix: 'f',
    aliases: ['file'],
    icon: 'file',
    placeholder: 'Search files in the active project…',
  },
  {
    id: 'plugins',
    label: 'Plugins',
    prefix: 'plugin',
    icon: 'plugin',
    placeholder: 'Search plugins…',
  },
  { id: 'skills', label: 'Skills', prefix: 'skill', icon: 'skill', placeholder: 'Search skills…' },
  {
    id: 'secrets',
    label: 'Secrets',
    prefix: 'secret',
    icon: 'key',
    placeholder: 'Search secret keys…',
  },
  { id: 'mcp', label: 'MCP', prefix: 'mcp', icon: 'mcp', placeholder: 'Search MCP servers…' },
  {
    id: 'agents',
    label: 'Agents',
    prefix: 'agent',
    icon: 'agent',
    placeholder: 'Search reusable agents…',
  },
  {
    id: 'models',
    label: 'Models',
    prefix: 'model',
    aliases: ['ai'],
    icon: 'provider',
    placeholder: 'Search models…',
  },
  {
    id: 'ui',
    label: 'UI',
    prefix: 'ui',
    aliases: ['open', 'view'],
    icon: 'command',
    clientOnly: true,
    placeholder: 'Open a Localix view…',
  },
  {
    id: 'settings',
    label: 'Settings',
    prefix: 'set',
    aliases: ['setting', 'prefs'],
    icon: 'settings',
    clientOnly: true,
    placeholder: 'Search settings…',
  },
  {
    id: 'commands',
    label: 'Commands',
    prefix: 'cmd',
    aliases: ['command', 'action'],
    icon: 'command',
    clientOnly: true,
    placeholder: 'Run a command…',
  },
]

/**
 * The full scope list: the core base fused with subsystem-contributed atoms. The
 * contributed (server) atoms are inserted before the trailing client-only ones so a
 * subsystem scope groups with the other backend domains in the picker.
 */
export function allScopes(): ScopeDef[] {
  const contributed = searchDomainScopes().map(({ id, scope }) => ({ id, ...scope }) as ScopeDef)
  if (contributed.length === 0) return BASE_SCOPES
  const serverBase = BASE_SCOPES.filter((s) => !s.clientOnly)
  const clientBase = BASE_SCOPES.filter((s) => s.clientOnly)
  return [...serverBase, ...contributed, ...clientBase]
}

/**
 * {@link allScopes} as a render reads it: read again when a mini app's search domain registers or
 * is switched. A plain call kept the scopes found at mount in the built app, whose React Compiler
 * memoizes it.
 */
export function useSearchScopes(): ScopeDef[] {
  return useMiniAppRegistrySlice('search-scopes', allScopes)
}

/** Resolve a scope by its id (including `all`) among `scopes`; undefined when unknown. */
export function scopeById(
  id: string | null | undefined,
  scopes: readonly ScopeDef[] = allScopes(),
): ScopeDef | undefined {
  if (!id) return undefined
  if (id === ALL_SCOPE.id) return ALL_SCOPE
  return scopes.find((s) => s.id === id)
}

/**
 * Split a leading typed prefix (`db:foo`) into `{ scope, text }`. Only recognized
 * prefixes/aliases promote; an unknown `word:foo` returns `{ scope: null, text: raw }`
 * so it stays a literal query.
 */
export function parseScope(raw: string): { scope: ScopeDef | null; text: string } {
  const m = /^([a-zA-Z][\w-]*):(.*)$/s.exec(raw)
  if (!m) return { scope: null, text: raw }
  const key = m[1]!.toLowerCase()
  const scope = allScopes().find((s) => s.prefix === key || s.aliases?.includes(key))
  if (!scope) return { scope: null, text: raw }
  return { scope, text: m[2]!.replace(/^\s+/, '') }
}

/** The `domains` array to send for an active scope id. `all`/null/client-only → undefined. */
export function scopeToDomains(scopeId: string | null): string[] | undefined {
  if (!scopeId || scopeId === ALL_SCOPE.id) return undefined
  const scope = scopeById(scopeId)
  if (!scope || scope.clientOnly) return undefined
  return [scopeId]
}
