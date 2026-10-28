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
 * `ToolSearch` — Claude Code's tool loader, a real core tool that is NOT in the catalog, because it
 * is built from the run's own deferred plugin/MCP set after assembly. The NAME still belongs to the
 * catalog's owner, which owns tool-name policy; the implementation imports it from here.
 */
export const ACTIVATE_TOOLS_TOOL_NAME = 'ToolSearch'

/**
 * Core-owned names that are NOT in the builtin catalog and must still never be claimed by
 * a plugin tool.
 *
 * `request_secret` is a human-in-the-loop request KIND, not a tool: the `Vault` tool
 * raises it, `chatService.submitSecret` is its dedicated answer leg, and the chat
 * surface renders it as a masked input. It used to be a tool of its own, so the name is
 * also load-bearing history. A plugin tool wearing it would make the transcript and the
 * audit trail ambiguous about which surface asked the user for a credential — exactly
 * the confusion the reserved set exists to prevent — while gaining nothing, since the
 * name carries no capability on its own.
 *
 * `ToolSearch` is reserved with the catalog's names (`tool-names.ts`).
 */
export const RESERVED_NON_TOOL_NAMES: readonly string[] = ['request_secret']
