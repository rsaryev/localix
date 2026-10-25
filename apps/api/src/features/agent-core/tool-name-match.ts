/**
 * Does a tool-list entry name this tool?
 *
 * A list a person or a plugin wrote (an agent's `tools`, a `disallowedTools`, a skill's
 * `disallowed-tools`) may name an MCP tool by the engine's name (`mcp_<server>_<tool>`) or by
 * Claude Code's address, which the tool carries as an alias (`mcp__<server>__<tool>`, a plugin's
 * server as `plugin_<plugin>_<server>`). A trailing `*` names every tool of ONE server, in either
 * spelling (`mcp__<server>__*`, `mcp_<server>_*`). Any other entry names a tool only exactly.
 */
export function namesTool(
  entry: string,
  tool: { name: string; aliases?: readonly string[] },
): boolean {
  if (entry === tool.name || tool.aliases?.includes(entry)) return true
  if (!entry.startsWith('mcp_') || !entry.endsWith('*')) return false
  const prefix = entry.slice(0, -1)
  const addresses = (tool.aliases ?? []).filter((alias) => alias.startsWith('mcp__'))
  if (prefix.startsWith('mcp__')) return addresses.some((address) => address.startsWith(prefix))
  // `mcp_ctl_*` must not take server `ctl_admin`'s tools: where the server's name ends is known
  // only from the tool's Claude Code address.
  if (addresses.length === 0) return tool.name.startsWith(prefix)
  return addresses.some((address) => engineServerPrefix(address) === prefix)
}

/**
 * `mcp_<server>_` for a Claude Code address: its server, a plugin's without `plugin_`, sanitized
 * as the engine names it (`mcp-tool-alias.ts` `normalizeMcpToolAlias`, `mcp/mcp-tools.ts`).
 */
function engineServerPrefix(address: string): string | undefined {
  const server = /^mcp__(.+?)__/.exec(address)?.[1]
  return server && `mcp_${server.replace(/^plugin_/, '')}_`.replace(/[^a-zA-Z0-9_]/g, '_')
}
