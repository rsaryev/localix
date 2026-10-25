import { mapCcToolList, splitDenyList } from '../../../ext/cc-tool-names'

const hasSpecifier = (entry: string) => entry.includes('(')

/**
 * Resolve the one denylist used by every per-run tool provider.
 *
 * Session/project settings already use engine names. Scoped skill/agent
 * frontmatter may use Claude Code aliases (including `mcp__server__tool`), so
 * normalize those once before the built-in/plugin registry and the later MCP
 * discovery stage consume the list. Stable de-duplication keeps prompt/runtime
 * diagnostics deterministic when both layers disable the same tool.
 *
 * An entry with a specifier (`Bash(rm *)`) removes no tool: it denies the calls it matches
 * (`resolveRunDenyPatterns`), and the tool stays for every other call.
 */
export function resolveRunDisabledTools(
  configured: readonly string[],
  scoped?: readonly string[],
): string[] {
  const plain = configured.filter((entry) => !hasSpecifier(entry))
  const wholeTools = splitDenyList(configured.filter(hasSpecifier)).tools
  const normalizedScoped = scoped?.length
    ? mapCcToolList(splitDenyList(scoped).tools, { dropUnknown: false })
    : []
  return [...new Set([...plain, ...wholeTools, ...normalizedScoped])]
}

/** The `name(specifier)` entries of the run's deny lists, to become permission rows. */
export function resolveRunDenyPatterns(
  configured: readonly string[],
  scoped?: readonly string[],
): string[] {
  return [
    ...new Set([
      ...splitDenyList(configured.filter(hasSpecifier)).patterned,
      ...splitDenyList([...(scoped ?? [])]).patterned,
    ]),
  ]
}
