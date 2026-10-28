import { TOOL } from '../../../agent-core/tool-names'
import { join } from 'node:path'
import { readMemoryIndex } from '../../../memory/auto-memory'
import type { LoadedPluginAgent } from '../../../plugins/loader-contract'

/**
 * What a run as an agent type takes from the agent file beyond its prompt and tools
 * (sub-agents.md, "Frontmatter reference"):
 *
 * - `autoCompactWindow`: the window the run compacts against;
 * - `memory`: a persistent folder — `~/.claude/agent-memory/<name>/` (user),
 *   `.claude/agent-memory/<name>/` (project) or `.claude/agent-memory-local/<name>/` (local) — whose
 *   `MEMORY.md`, its first 200 lines or 25KB, joins the instructions with how to keep it, and the
 *   file tools to keep it with.
 */
export interface SubagentRunOptions {
  contextLimit?: number
  /** Appended to the agent's instructions. */
  instructions?: string
  /** Tools the run must hold although the agent's `tools` leave them out. */
  enableTools: string[]
  /** The `memory` folder, which the run writes without a card (`memory-roots.ts`). */
  memoryDir?: string
}

export function agentMemoryDir(
  agent: Pick<LoadedPluginAgent, 'name' | 'memory'>,
  dirs: { projectDir: string; homeDir: string },
): string | null {
  const leaf = agent.name.split(':').pop() ?? agent.name
  switch (agent.memory) {
    case 'user':
      return join(dirs.homeDir, '.claude', 'agent-memory', leaf)
    case 'project':
      return join(dirs.projectDir, '.claude', 'agent-memory', leaf)
    case 'local':
      return join(dirs.projectDir, '.claude', 'agent-memory-local', leaf)
    case undefined:
      return null
  }
}

export async function subagentRunOptions(
  agent: Pick<LoadedPluginAgent, 'name' | 'autoCompactWindow' | 'memory'>,
  dirs: { projectDir: string; homeDir: string },
): Promise<SubagentRunOptions> {
  const options: SubagentRunOptions = {
    enableTools: [],
    ...(agent.autoCompactWindow ? { contextLimit: agent.autoCompactWindow } : {}),
  }
  const dir = agentMemoryDir(agent, dirs)
  if (!dir) return options
  const { index: head, clipped } = await readMemoryIndex(dir)
  options.memoryDir = dir
  options.instructions = [
    '# Agent memory',
    `You have a persistent memory folder at ${dir}, kept across conversations. Read it before you start, and save what you learn there (codebase patterns, decisions, recurring issues) before you finish. Keep an index in MEMORY.md and put details in topic files beside it.`,
    head
      ? `## MEMORY.md${clipped ? ' (first 200 lines or 25KB; curate it to stay within that)' : ''}\n${head}`
      : 'MEMORY.md does not exist yet.',
  ].join('\n\n')
  options.enableTools = [TOOL.Read, TOOL.Write, TOOL.Edit]
  return options
}

/** A run as an agent type with its file's options applied to its instructions and tools. */
export function withSubagentRunOptions<
  T extends { agent: { instructions?: string | null }; disabledTools: string[] },
>(typed: T, options: SubagentRunOptions): T {
  const enable = new Set(options.enableTools)
  return {
    ...typed,
    agent: options.instructions
      ? {
          ...typed.agent,
          instructions: [typed.agent.instructions, options.instructions]
            .filter(Boolean)
            .join('\n\n'),
        }
      : typed.agent,
    disabledTools: typed.disabledTools.filter((name) => !enable.has(name)),
  }
}
