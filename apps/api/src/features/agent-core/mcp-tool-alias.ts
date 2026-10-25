/**
 * Map a Claude Code MCP tool name (`mcp__<server>__<tool>`) to the engine's
 * namespaced form (`mcp_<server>_<tool>`), or `undefined` when the token is not
 * an MCP name. Localix emits `mcp_<server>_<tool>` (single underscore, non-word
 * chars sanitized to `_`); CC uses the double-underscore form. Accepting the CC
 * form as an alias lets a ported `allowed-tools` / permission rule keep matching
 * without renaming any live tool. Case is PRESERVED (server/tool names are not
 * lowercased by the engine).
 *
 * A plugin's server is `plugin_<plugin>_<server>` in Claude Code's address and the record
 * `<plugin>_<server>` here (`plugins/mcp.ts`), so `mcp__plugin_p_s__t` → `mcp_p_s_t`. A trailing
 * `*` (`mcp__<server>__*`, every tool of a server) is kept: `mcp_<server>_*`.
 */
export function normalizeMcpToolAlias(name: string): string | undefined {
  if (!name.startsWith('mcp__')) return undefined
  const wildcard = name.endsWith('*')
  const address = name.slice('mcp__'.length, wildcard ? -1 : undefined)
  // The server ends at the first `__`; the tool keeps any `__` of its own, as the engine does.
  const split = address.indexOf('__')
  const server = (split < 0 ? address : address.slice(0, split)).replace(/^plugin_/, '')
  const tool = split < 0 ? undefined : address.slice(split + 2)
  // The same sanitization the engine's `namespacedName` applies (`mcp/mcp-tools.ts`).
  // permissions.md: "`mcp__puppeteer` matches any tool provided by the `puppeteer` server".
  if (tool === undefined && !wildcard) return `mcp_${server}_*`.replace(/[^a-zA-Z0-9_*]/g, '_')
  const engine = `mcp_${server}${tool === undefined ? '' : `_${tool}`}`.replace(
    /[^a-zA-Z0-9_]/g,
    '_',
  )
  return wildcard ? `${engine}*` : engine
}
