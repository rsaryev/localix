/**
 * Core-owned tool NAMES that are not catalog entries.
 *
 * Split from `tool-names.ts` for size, and it imports NOTHING — deliberately. The catalog
 * re-exports what this file declares, so an edge in the other direction would be a cycle:
 * `tool-names.ts` evaluates its re-export first (imports hoist), this module would read
 * `TOOL` before the catalog had initialized it, and every consumer would fail with "Cannot
 * access 'TOOL' before initialization". Anything here that needs the catalog is COMPOSED in
 * `tool-names.ts` instead, where the catalog already exists.
 */

/**
 * `activate_tools` — a real core tool that is NOT in the catalog, because it is built from the
 * run's own deferred plugin/MCP set after assembly. The NAME still belongs to the catalog's
 * owner, which owns tool-name policy; the implementation imports it from here.
 */
export const ACTIVATE_TOOLS_TOOL_NAME = 'activate_tools'

/**
 * Core-owned names that are NOT in the builtin catalog and must still never be claimed by
 * a plugin tool.
 *
 * `request_secret` is a human-in-the-loop request KIND, not a tool: the `vault` tool
 * raises it, `chatService.submitSecret` is its dedicated answer leg, and the chat
 * surface renders it as a masked input. It used to be a tool of its own, so the name is
 * also load-bearing history. A plugin tool wearing it would make the transcript and the
 * audit trail ambiguous about which surface asked the user for a credential — exactly
 * the confusion the reserved set exists to prevent — while gaining nothing, since the
 * name carries no capability on its own.
 *
 * `activate_tools` IS a real tool, but it is not in the catalog because it is built from
 * the run's deferred set after plugin/MCP assembly (`run/tool-assembly.ts`). Reserving the
 * name stops a plugin from shadowing the activator that makes every deferred tool reachable.
 */
export const RESERVED_NON_TOOL_NAMES: readonly string[] = [
  'request_secret',
  ACTIVATE_TOOLS_TOOL_NAME,
]

/**
 * Names of REMOVED core tools whose calls older transcripts still hold. No run builds them, so
 * they are not mechanisms the permission gate passes; they are only kept from plugins, because a
 * plugin tool by one of these names would make those transcripts read as calls to something else.
 *
 * `apply_patch` and `view_image` were folded into `edit` and `read`. `conversation_control` ended
 * every group turn with a hidden note and the next speakers; a reply's own `@handle` addresses do
 * that now, and `set_topic` took over its topic field.
 */
export const HISTORICAL_TOOL_NAMES: readonly string[] = [
  'apply_patch',
  'view_image',
  'conversation_control',
]
