import type { PluginSession, Resolved, ResolvedMcpServer } from '@rsaryev/llx-plugin'
import type { LocalixPluginHost } from './host'
import type { ManagedSettingsSource } from './settings/managed'
import { openOwnSession, sessionOwn, type ScopePlugin } from './sessions'
import { readClaudeSettings } from './settings/read'

/** One scope: its folder, the home its Claude Code settings are read from, its catalog. */
export interface PluginScope {
  readonly cwd: string
  readonly homeDir: string
  readonly plugins: readonly ScopePlugin[]
  /** The managed settings; the machine's own by default, `null` for none. */
  readonly managed?: ManagedSettingsSource | null
}

/**
 * A kit session of a scope outside any chat, opened as a chat's run opens its own
 * (`openOwnSession`), with the folder's Claude Code settings: what a loader asks of the scope (its
 * MCP servers, its subagents, its skills) is answered by the kit as a run in that folder would see it.
 */
export async function openScopeSession(
  host: LocalixPluginHost,
  scope: PluginScope,
  sessionId: string,
): Promise<PluginSession> {
  const settings = await readClaudeSettings({
    homeDir: scope.homeDir,
    cwd: scope.cwd,
    ...(scope.managed === undefined ? {} : { managed: scope.managed }),
  })
  const own = sessionOwn(host, { layers: settings.layers, plugins: scope.plugins })
  const session = { sessionId, cwd: scope.cwd, transcriptPath: '', trusted: settings.trusted }
  return openOwnSession(host, own, { ...session, permissionMode: 'default' }, scope.homeDir)
}

/**
 * The MCP servers of a scope's plugins as the kit resolves them (`session.mcpServers`). A server
 * that does not start (a bundle's required setting unsaved, a variable unset) is left out and its
 * issue reported.
 */
export async function scopeMcpServers(
  host: LocalixPluginHost,
  scope: PluginScope,
): Promise<Resolved<ResolvedMcpServer>> {
  return (await openScopeSession(host, scope, 'mcp-servers')).mcpServers()
}
