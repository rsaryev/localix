import type { AgentTool } from '@localixai/agent/agents'

export interface ClaimedToolSet {
  /** Secondary descriptors whose names were not already owned by primary. */
  tools: AgentTool[]
  /** Names rejected because primary (or an earlier secondary row) already owns them. */
  conflicts: string[]
}

/**
 * Descriptor-owned UI metadata for every tool the runtime may dispatch.
 *
 * This must be indexed from `dispatchTools`, not only the initially model-visible
 * `tools` projection: plugin/MCP tools can be revealed later by `activate_tools`,
 * but their presentation contract (`activeVerb`, `standalone`) is already part of
 * the canonical descriptor. Keeping the lookup generic lets any deferred tool own
 * an interactive surface without the chat runtime knowing its name.
 */
export function indexToolPresentation(
  tools: readonly AgentTool[],
): Map<string, Pick<AgentTool, 'activeVerb' | 'standalone' | 'presentation'>> {
  return new Map(
    tools.map((tool) => [
      tool.name,
      {
        activeVerb: tool.activeVerb,
        standalone: tool.standalone,
        presentation: tool.presentation,
      },
    ]),
  )
}

/**
 * Merge a later tool provider into the canonical runtime namespace.
 *
 * The provider/runtime boundary requires one descriptor per name. MCP tools are
 * discovered after the built-in/plugin registry, so they are the secondary
 * owner: a colliding MCP name must not reach either model or dispatch.
 */
export function claimSecondaryTools(
  primary: readonly AgentTool[],
  secondary: readonly AgentTool[],
): ClaimedToolSet {
  const claimed = new Set(primary.map((tool) => tool.name))
  const tools: AgentTool[] = []
  const conflicts = new Set<string>()

  for (const tool of secondary) {
    if (claimed.has(tool.name)) {
      conflicts.add(tool.name)
      continue
    }
    claimed.add(tool.name)
    tools.push(tool)
  }

  return {
    tools,
    conflicts: [...conflicts].sort(),
  }
}
