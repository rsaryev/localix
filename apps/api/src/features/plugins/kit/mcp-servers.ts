import type { PluginIssue, ResolvedMcpServer } from '@rsaryev/llx-plugin'
import type { LocalixPluginHost } from './host'
import { openScopeSession, type PluginScope } from './scope-session'

/** One scope: its folder, the home its Claude Code settings are read from, its catalog. */
export type McpScope = PluginScope

export interface ScopeMcpServers {
  readonly resolved: readonly ResolvedMcpServer[]
  readonly issues: readonly PluginIssue[]
}

/**
 * The MCP servers of a scope's plugins as the kit resolves them (`session.mcpServers`) in a
 * session of the scope (`./scope-session`). A server that does not start (a bundle's required
 * setting unsaved, a variable unset) is left out and its issue reported.
 */
export async function scopeMcpServers(
  host: LocalixPluginHost,
  scope: McpScope,
): Promise<ScopeMcpServers> {
  return (await openScopeSession(host, scope, 'mcp-servers')).mcpServers()
}
