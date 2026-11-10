import type { HooksSettings, PluginSession } from '@rsaryev/llx-plugin'
import { agentHookGroups } from '@rsaryev/llx-plugin/agents'

/** A skill's or an agent's frontmatter `hooks`, as the run holds them. */
export interface ScopedHooksBlock {
  readonly raw: unknown
  readonly source: 'skill' | 'agent'
  /** `Stop` becomes `SubagentStop`: the block runs in a subagent. */
  readonly asSubagent?: boolean
  /** The plugin that bundled it: its folder is `${CLAUDE_PLUGIN_ROOT}`. */
  readonly plugin?: { readonly name: string }
  readonly pluginId?: string
  /** Kept for the session's later runs (a skill's); else this run's only. */
  readonly lifetime?: 'session'
}

/**
 * Registers the run's scoped hooks on the session, each block under its own prefix, and drops the
 * blocks of the previous run that this one does not hold (`previous`, what the last call returned).
 * A skill's block keeps one prefix for the session, so invoking it again registers nothing new.
 */
export function registerScopedHooks(
  session: PluginSession,
  blocks: readonly ScopedHooksBlock[],
  previous: readonly string[],
): string[] {
  const held = blocks.map((block, index) => {
    const prefix =
      block.lifetime === 'session'
        ? `skill:${JSON.stringify([block.plugin?.name ?? null, block.raw])}`
        : `run:${index}`
    // A plugin's agent brings no hooks (Claude Code); the kit says so through its source.
    const source = block.plugin && block.source === 'agent' ? 'plugin' : 'user'
    const hooks = agentHookGroups(
      { hooks: block.raw as HooksSettings, source },
      block.asSubagent ? 'subagent' : 'main-session',
    )
    session.addHooks(
      prefix,
      hooks,
      {
        kind: block.source,
        label: block.plugin ? `[${block.plugin.name}]` : `[${block.source}]`,
        ...(block.plugin ? { pluginName: block.plugin.name } : {}),
      },
      block.pluginId ? { pluginId: block.pluginId } : {},
    )
    return prefix
  })
  for (const prefix of previous) if (!held.includes(prefix)) session.removeHooks(prefix)
  return held
}
