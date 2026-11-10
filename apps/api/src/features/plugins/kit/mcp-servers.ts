import type { PluginIssue, ResolvedMcpServer } from '@rsaryev/llx-plugin'
import { createPolicyView } from '@rsaryev/llx-plugin/settings'
import type { LocalixPluginHost } from './host'
import { sessionLocations, sessionOwn, type ScopePlugin } from './sessions'
import { readClaudeSettings } from './settings/read'

/** One scope: its folder, the home its Claude Code settings are read from, its catalog. */
export interface McpScope {
  readonly cwd: string
  readonly homeDir: string
  readonly plugins: readonly ScopePlugin[]
}

export interface ScopeMcpServers {
  readonly resolved: readonly ResolvedMcpServer[]
  readonly issues: readonly PluginIssue[]
}

/**
 * The MCP servers of a scope's plugins as the kit resolves them (`session.mcpServers`): a session
 * of the scope, set up as a chat's run sets up its own (`./sessions`), with the folder's Claude
 * Code settings. A server that does not start (a bundle's required setting unsaved, a variable
 * unset) is left out and its issue reported.
 */
export async function scopeMcpServers(
  host: LocalixPluginHost,
  scope: McpScope,
): Promise<ScopeMcpServers> {
  const settings = await readClaudeSettings({ homeDir: scope.homeDir, cwd: scope.cwd })
  const own = sessionOwn(host, { layers: settings.layers, plugins: scope.plugins })
  const session = host.kit.openSession({
    sessionId: 'mcp-servers',
    cwd: scope.cwd,
    permissionMode: 'default',
    transcriptPath: '',
    trusted: settings.trusted,
    settings: createPolicyView(own.layers),
    plugins: own.plugins.map(({ id, plugin }) => ({ id, plugin })),
    userConfig: own.userConfig,
    locations: sessionLocations(host, scope.cwd, own.plugins),
  })
  return session.mcpServers()
}
