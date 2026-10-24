import { isRecord } from '../../lib/record'
import type { SettingsLayer } from '../cc-settings/settings-files'
import { expandString } from './expand'
import type { McpServerRecord } from './repository'

/**
 * An organization's MCP allow and deny lists from Claude Code's settings (managed-mcp.md,
 * "Policy-based control with allowlists and denylists"), applied to every server a run would
 * connect — the person's own, a plugin's, and the ones Claude Code's files define:
 *
 *   - `deniedMcpServers` from every file blocks a matching server, whatever else says;
 *   - `allowedMcpServers` from every file (only the managed one under
 *     `allowManagedMcpServersOnly`), when set anywhere, keeps only matching servers: a remote one
 *     by `serverUrl`, a stdio one by `serverCommand`, by `serverName` only when the list has no
 *     entry of its kind. The organization's own servers skip the allow list.
 */

type Entry = { serverName?: string; serverCommand?: string[]; serverUrl?: string }

function entries(value: unknown): Entry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): Entry[] => {
    if (!isRecord(item)) return []
    if (typeof item.serverName === 'string') return [{ serverName: item.serverName }]
    if (typeof item.serverUrl === 'string') return [{ serverUrl: item.serverUrl }]
    if (Array.isArray(item.serverCommand) && item.serverCommand.every((p) => typeof p === 'string'))
      return [{ serverCommand: item.serverCommand as string[] }]
    return []
  })
}

const escape = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

/** A `serverUrl` pattern against a URL, with Claude Code's port rule. */
export function urlPatternMatches(pattern: string, url: string): boolean {
  const parse = (raw: string) => /^([^:]+):\/\/([^/:]+)(?::([^/]*))?(\/.*)?$/.exec(raw.trim())
  const p = parse(pattern)
  const u = parse(url)
  if (!p || !u) return false
  const glob = (pat: string, value: string, flags = '') =>
    new RegExp(`^${pat.split('*').map(escape).join('.*')}$`, flags).test(value)
  const [, pScheme, pHost, pPort, pPath] = p
  const [, uScheme, uHost, uPort, uPath] = u
  if (!glob(pScheme!, uScheme!, 'i')) return false
  const host = (h: string) => h.toLowerCase().replace(/\.$/, '')
  if (!glob(host(pHost!), host(uHost!))) return false
  const defaultPort = (scheme: string) => (scheme.toLowerCase() === 'http' ? '80' : '443')
  const actualPort = uPort || defaultPort(uScheme!)
  if (pPort !== undefined) {
    if (!glob(pPort, actualPort)) return false
  } else if (!pHost!.includes('*') && actualPort !== defaultPort(uScheme!)) return false
  return pPath === undefined || pPath === '/*' || glob(pPath, uPath ?? '/')
}

function commandOf(server: McpServerRecord): string[] | undefined {
  const command = server.config.command
  return Array.isArray(command) ? command.map(String) : undefined
}

function matches(entry: Entry, server: McpServerRecord, env: Record<string, string | undefined>) {
  if (entry.serverName !== undefined) return entry.serverName === server.name
  const expand = (text: string) => expandString(text, env)
  if (entry.serverUrl !== undefined) {
    const url = server.config.url
    return typeof url === 'string' && urlPatternMatches(expand(entry.serverUrl), expand(url))
  }
  const command = commandOf(server)
  const wanted = entry.serverCommand?.map(expand)
  return (
    command !== undefined &&
    wanted !== undefined &&
    command.length === wanted.length &&
    command.every((part, i) => expand(part) === wanted[i])
  )
}

export function mcpServerPolicy(
  layers: readonly SettingsLayer[],
  env: Record<string, string | undefined> = process.env,
) {
  const managedOnly = layers.some(
    (l) => l.source === 'policy' && l.settings.allowManagedMcpServersOnly === true,
  )
  const denied = layers.flatMap((l) => entries(l.settings.deniedMcpServers))
  const allowSources = layers.filter(
    (l) => l.settings.allowedMcpServers !== undefined && (!managedOnly || l.source === 'policy'),
  )
  const allowed =
    allowSources.length > 0
      ? allowSources.flatMap((l) => entries(l.settings.allowedMcpServers))
      : undefined
  return {
    /** Whether the server may load; `organization` servers skip the allow list. */
    admits(server: McpServerRecord, organization = false): boolean {
      if (denied.some((entry) => matches(entry, server, env))) return false
      if (!allowed || organization) return true
      const remote = typeof server.config.url === 'string'
      const ofKind = allowed.filter((e) => (remote ? e.serverUrl : e.serverCommand) !== undefined)
      const byName = ofKind.length === 0 ? allowed.filter((e) => e.serverName !== undefined) : []
      return [...ofKind, ...byName].some((entry) => matches(entry, server, env))
    },
  }
}
