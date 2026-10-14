import { CORE_RESERVED_TOOL_NAMES } from '../agent-core/tool-names'

/**
 * Naming policy for plugin-provided tools. A plugin tool must have a syntactically
 * valid name AND not collide with a built-in (which it would otherwise shadow). The
 * reserved set is derived from the canonical core vocabulary: ordinary built-ins
 * plus conditional runtime tools such as `vault`. There is no parallel
 * hand-maintained copy to drift out of sync.
 *
 * Only names core ACTUALLY registers belong in `BUILTIN_TOOL_NAMES`; extension-owned
 * names are never copied into it and register freely. The reserved set exists solely
 * to stop an extension from shadowing a real core tool.
 *
 * The `mcp_` prefix is ALSO reserved: MCP server tools are namespaced
 * `mcp_<server>_<tool>` at gather time (mcp/client-manager.ts) and pushed into the
 * same tool array as plugin tools, where the agent loop's toolsMap is last-writer-
 * wins. A plugin tool named `mcp_*` would silently shadow (or be shadowed by) a real
 * MCP tool and double its schema in the prompt — reject it at load with a warning.
 */

/**
 * A canonical plugin tool name: 1–64 lowercase ASCII chars, digits, and
 * underscores; never leading-underscore.
 *
 * Lowercase is part of identity, not presentation. CC frontmatter and
 * permission rules normalize ordinary tool names to lowercase, so accepting
 * `Bash` beside `bash` would bypass the reserved namespace and accepting a lone
 * `MyTool` would make `disallowedTools: MyTool` target a different runtime
 * name. Reject non-canonical names at the contribution boundary instead of
 * carrying two incompatible identity rules.
 */
export const TOOL_NAME_RE = /^[a-z0-9][a-z0-9_]{0,63}$/

/** Namespace prefix owned by MCP server tools — plugins may not claim it. */
const MCP_TOOL_PREFIX = 'mcp_'

/**
 * Native plugins are trusted code, but their model-facing metadata still shares every
 * request's context budget. This ceiling leaves ample room for detailed what/when/how/caveat
 * guidance while preventing one plugin from crowding out the run.
 */
export const PLUGIN_TOOL_DESCRIPTION_MAX_CHARS = 4_000

export function capPluginToolDescription(description: string): string {
  if (description.length <= PLUGIN_TOOL_DESCRIPTION_MAX_CHARS) return description
  return `${description.slice(0, PLUGIN_TOOL_DESCRIPTION_MAX_CHARS - 1)}…`
}

const RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set(CORE_RESERVED_TOOL_NAMES)

/** True when a plugin may register a tool under this name (valid shape + not reserved). */
export function isAcceptableToolName(name: string): boolean {
  return (
    TOOL_NAME_RE.test(name) &&
    !RESERVED_TOOL_NAMES.has(name) &&
    !name.toLowerCase().startsWith(MCP_TOOL_PREFIX)
  )
}

/** Whether a name belongs to a built-in tool (exposed for diagnostics/tests). */
export function isReservedToolName(name: string): boolean {
  return RESERVED_TOOL_NAMES.has(name)
}
