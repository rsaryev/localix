import { readAgent } from '@rsaryev/llx-plugin/format'
import type { PluginAgent } from '../../contracts'
import { agentOf } from './components'

/** An agent file of a person's or a project's `agents` folder, as the kit reads it. */
export interface AgentFileRead {
  agent: PluginAgent
  permissionMode?: string
}

/**
 * One agent file (sub-agents.md), or undefined when Claude Code would not load it (no `name`, no
 * `description`, a name it refuses).
 */
export function readAgentText(
  text: string,
  path: string,
  source: 'managed' | 'project' | 'user',
): AgentFileRead | undefined {
  const read = readAgent(text, { path, source })
  if (read.outcome !== 'loaded') return undefined
  const { permissionMode } = read.agent.definition
  return { agent: agentOf(read.agent, ''), ...(permissionMode ? { permissionMode } : {}) }
}
