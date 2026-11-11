import { agentMemory, type AgentMemoryContext } from '../../../plugins/kit'
import type { CatalogAgent } from '@rsaryev/llx-plugin/agents'

/**
 * What a run as an agent type takes from the agent file beyond its prompt and tools
 * (sub-agents.md, "Frontmatter reference"): `autoCompactWindow`, the window the run compacts
 * against, and `memory`, a persistent folder the kit plans (`agentMemory`) whose `MEMORY.md` joins
 * the instructions with how to keep it, and the file tools to keep it with.
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

export async function subagentRunOptions(
  agent: Pick<CatalogAgent, 'name' | 'definition'>,
  context: AgentMemoryContext,
): Promise<SubagentRunOptions> {
  const { autoCompactWindow, memory: scope } = agent.definition
  const options: SubagentRunOptions = {
    enableTools: [],
    ...(autoCompactWindow ? { contextLimit: autoCompactWindow } : {}),
  }
  const memory = await agentMemory(scope, agent.name, context)
  if (!memory) return options
  const dir = memory.directory
  options.memoryDir = dir
  options.instructions = [
    '# Agent memory',
    `You have a persistent memory folder at ${dir}, kept across conversations. Read it before you start, and save what you learn there (codebase patterns, decisions, recurring issues) before you finish. Keep an index in MEMORY.md and put details in topic files beside it.`,
    memory.index.trim()
      ? `## MEMORY.md${memory.truncated ? ' (first 200 lines or 25KB; curate it to stay within that)' : ''}\n${memory.index.trimEnd()}`
      : 'MEMORY.md does not exist yet.',
  ].join('\n\n')
  options.enableTools = [...memory.addTools]
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
