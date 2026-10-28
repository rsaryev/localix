import { runKeepsMemory } from '../../../agent-core/prompt/sections/memory'
import type { RunProfile } from '../../../agent-core/run-shape'

/**
 * The memory folders a run keeps with the file tools and no card: they live outside the project
 * (`~/.claude/projects/<project>/memory`, `~/.claude/agent-memory/<name>`), where the gate would
 * otherwise ask. Only the run's own: another project's memory still asks.
 */
export function memoryRoots(input: {
  profile: RunProfile
  /** The conversation's auto memory folder (`features/memory/auto-memory.ts`). */
  memoryDir?: string | null
  hasTool: (name: string) => boolean
  /** A fork: it was sent its parent's prompt, memory section included. */
  fork?: boolean
  /** The folder of the agent file's own `memory` (`subagent-file-options.ts`). */
  agentMemoryDir?: string | null
}): string[] {
  const roots: string[] = []
  const keeps = input.fork || runKeepsMemory(input.profile, input.hasTool)
  if (input.memoryDir && keeps) roots.push(input.memoryDir)
  if (input.agentMemoryDir) roots.push(input.agentMemoryDir)
  return roots
}
