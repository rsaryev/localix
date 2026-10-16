import { mapCcToolList } from '../../../ext/cc-tool-names'

/**
 * Resolve the one denylist used by every per-run tool provider.
 *
 * Session/project settings already use engine names. Scoped skill/agent
 * frontmatter may use Claude Code aliases (including `mcp__server__tool`), so
 * normalize those once before the built-in/plugin registry and the later MCP
 * discovery stage consume the list. Stable de-duplication keeps prompt/runtime
 * diagnostics deterministic when both layers disable the same tool.
 */
export function resolveRunDisabledTools(
  configured: readonly string[],
  scoped?: readonly string[],
): string[] {
  const normalizedScoped = scoped?.length ? mapCcToolList([...scoped], { dropUnknown: false }) : []
  return [...new Set([...configured, ...normalizedScoped])]
}
