import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

import { CC_TOOL_NAME_MAP } from '../../../ext/cc-tool-names'
import type { LoadedPluginAgent } from '../../../plugins/loader-contract'

/** The tools a Claude Code agent's `tools` list chooses among, as this host names them. */
const CC_TOOLS: ReadonlySet<string> = new Set(Object.values(CC_TOOL_NAME_MAP))

/**
 * The `agent` setting (`settings.json` of the person, the project or a plugin), as Claude Code
 * applies it: the main thread runs as that agent, with its system prompt and tool restrictions.
 * The caller picks the agent in Claude Code's order; it applies only to a chat run by the default
 * Localix agent. A chat with an agent the person picked, a delegated child and a job keep their own.
 *
 * The agent's prompt becomes the run's identity; its `disallowedTools` are switched off, and a
 * `tools` list switches off the other tools a Claude Code agent could have named. Its `model`
 * applies unless the person picked the chat's model (`plugin-main-agent-model.ts`).
 */
export function applyMainAgent<Agent extends { id: string; instructions?: string | null }>(
  input: { agent: Agent; disabledTools: readonly string[] },
  mainAgent: LoadedPluginAgent | null,
  run: { speakerAgentId: string; host: string },
): { agent: Agent; disabledTools: string[]; mainAgent: LoadedPluginAgent | null } {
  const applies =
    mainAgent !== null && run.host === 'chat' && run.speakerAgentId === DEFAULT_AGENT_ID
  if (!applies) return { ...input, disabledTools: [...input.disabledTools], mainAgent: null }
  return { ...runAsPluginAgent(input, mainAgent), mainAgent }
}

/**
 * A run as a plugin agent: its prompt is the identity; its `disallowedTools` are switched off, and a
 * `tools` list switches off the other tools a Claude Code agent could have named.
 */
export function runAsPluginAgent<Agent extends { instructions?: string | null }>(
  input: { agent: Agent; disabledTools: readonly string[] },
  pluginAgent: Pick<LoadedPluginAgent, 'prompt' | 'tools' | 'disallowedTools'>,
): { agent: Agent; disabledTools: string[] } {
  const allowed = pluginAgent.tools ? new Set(pluginAgent.tools) : null
  const off = [
    ...(pluginAgent.disallowedTools ?? []),
    ...(allowed ? [...CC_TOOLS].filter((name) => !allowed.has(name)) : []),
  ]
  return {
    agent: { ...input.agent, instructions: pluginAgent.prompt },
    disabledTools: [...new Set([...input.disabledTools, ...off])],
  }
}

/**
 * Whose `tools` list is the run's exact surface (`run-profile.ts`): the agent type a child runs
 * as, else the plugin agent the chat runs as when its file has a list. Without a list the chat
 * keeps its own surface, and only the Claude Code tools a list would name are switched off.
 */
export function runToolsAgent<T extends { tools?: readonly string[] }>(
  subagent: T | null | undefined,
  mainAgent: { tools?: readonly string[] } | null | undefined,
): T | { tools: readonly string[] } | null {
  if (subagent) return subagent
  return mainAgent?.tools ? { tools: mainAgent.tools } : null
}
