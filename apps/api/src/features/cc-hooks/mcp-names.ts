/**
 * CC ↔ engine name mapping for PLUGIN MCP tools.
 *
 * Claude Code addresses a plugin's MCP tools as `mcp__plugin_<plugin>_<server>__<tool>`
 * and lets hook `mcp_tool` handlers reference the server as `plugin:<plugin>:<server>`.
 * Our engine registers the same tool as `mcp_<plugin>_<server>_<tool>` (the plugin's
 * server record is named `<plugin>_<server>` — see plugins/mcp.ts — and the MCP
 * feature namespaces tools `mcp_<serverName>_<toolName>`, sanitizing non-word chars
 * to `_`). We never rename live tools; instead the CC forms are ALIASED wherever CC
 * configs are consumed (hook matchers + mcp_tool handler resolution).
 *
 * Pure module — string mapping only, no imports.
 */

/** Same sanitization the MCP feature's `namespacedName` applies (mcp-tools.ts). */
function sanitizeMcpName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, '_')
}

/** The engine tool name for a plugin MCP tool: `mcp_<plugin>_<server>_<tool>`. */
export function enginePluginMcpToolName(plugin: string, server: string, tool: string): string {
  return sanitizeMcpName(`mcp_${plugin}_${server}_${tool}`)
}

/** The CC address for the same tool: `mcp__plugin_<plugin>_<server>__<tool>`. */
export function ccPluginMcpToolName(plugin: string, server: string, tool: string): string {
  return `mcp__plugin_${plugin}_${server}__${tool}`
}

/**
 * Map a full CC plugin MCP tool name (`mcp__plugin_<plugin>_<server>__<tool>`) to the
 * engine's form (`mcp_<plugin>_<server>_<tool>`), or `undefined` when the input is not
 * in that shape. The server/tool split is at the LAST `__` (CC's separator), and CC's
 * `plugin_` server-key prefix is dropped — our server record is `<plugin>_<server>`.
 */
export function ccPluginMcpToolToEngine(name: string): string | undefined {
  const m = /^mcp__plugin_(.+)__([^_].*)$/.exec(name)
  if (!m) return undefined
  return sanitizeMcpName(`mcp_${m[1]}_${m[2]}`)
}

/**
 * Resolve a hook `mcp_tool` handler's `server: "plugin:<plugin>:<server>"` reference
 * plus its `tool` to the engine tool name, or `undefined` when `serverRef` is not the
 * plugin-scoped form (plain server names keep the generic `mcp__<server>__<tool>` path).
 */
export function pluginServerRefToEngineMcpTool(
  serverRef: string,
  tool: string,
): string | undefined {
  const m = /^plugin:([^:]+):([^:]+)$/.exec(serverRef)
  if (!m) return undefined
  return enginePluginMcpToolName(m[1], m[2], tool)
}

/**
 * The alias forms a CC-written matcher token may take for one engine MCP tool name.
 * Given a matcher token (exact string or regex SOURCE) that starts with `mcp__`,
 * returns the token itself plus its engine-form rewrites:
 *   - generic collapse:  `mcp__memory__create`            → `mcp_memory_create`
 *   - plugin-form strip: `mcp__plugin_foo_bar__baz`       → `mcp_foo_bar_baz`
 * The rewrites are TEXTUAL (only the literal `mcp__`/`plugin_` markers change), so
 * they are safe for regex sources too (`mcp__memory__.*` → `mcp_memory_.*`). A token
 * that does not start with `mcp__` is returned unchanged as the only variant.
 */
export function ccMcpMatcherVariants(token: string): string[] {
  if (!token.startsWith('mcp__')) return [token]
  const variants = [token, `mcp_${token.slice('mcp__'.length).replace(/__/g, '_')}`]
  if (token.startsWith('mcp__plugin_')) {
    variants.push(`mcp_${token.slice('mcp__plugin_'.length).replace(/__/g, '_')}`)
  }
  return [...new Set(variants)]
}
