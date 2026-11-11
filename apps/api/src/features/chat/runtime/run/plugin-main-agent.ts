import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'

import type { CatalogAgent } from '@rsaryev/llx-plugin/agents'

/**
 * The `agent` setting (`settings.json` of the person, the project or a plugin), as Claude Code
 * applies it: the main thread runs as that agent, with its system prompt and tool restrictions.
 * The caller picks the agent in Claude Code's order; it applies only to a chat run by the default
 * Localix agent. A chat with an agent the person picked, a delegated child and a job keep their own.
 *
 * The agent's prompt becomes the run's identity; its `tools` and `disallowedTools` narrow the run's
 * tools as the kit resolves them (`runToolsAgent`, `plugins/kit/subagent-tools.ts`). Its `model`
 * applies unless the person picked the chat's model (`plugin-main-agent-model.ts`).
 */
export function applyMainAgent<Agent extends { id: string; instructions?: string | null }>(
  input: { agent: Agent; disabledTools: readonly string[] },
  mainAgent: CatalogAgent | null,
  run: { agentId: string; host: string },
): { agent: Agent; disabledTools: string[]; mainAgent: CatalogAgent | null } {
  const applies = mainAgent !== null && run.host === 'chat' && run.agentId === DEFAULT_AGENT_ID
  if (!applies) return { ...input, disabledTools: [...input.disabledTools], mainAgent: null }
  return { ...runAsPluginAgent(input, mainAgent), mainAgent }
}

/** A run as a plugin agent: its prompt is the identity (its tools: `runToolsAgent`). */
export function runAsPluginAgent<Agent extends { instructions?: string | null }>(
  input: { agent: Agent; disabledTools: readonly string[] },
  pluginAgent: Pick<CatalogAgent, 'definition'>,
): { agent: Agent; disabledTools: string[] } {
  return {
    agent: { ...input.agent, instructions: pluginAgent.definition.prompt },
    disabledTools: [...input.disabledTools],
  }
}

/**
 * Whose `tools` and `disallowedTools` narrow the run: the agent type a child runs as, else the
 * plugin agent the chat runs as, which is the main thread.
 */
export function runToolsAgent(
  subagent: CatalogAgent | null | undefined,
  mainAgent: CatalogAgent | null | undefined,
): { agent: CatalogAgent; asMainThread: boolean } | null {
  if (subagent) return { agent: subagent, asMainThread: false }
  return mainAgent ? { agent: mainAgent, asMainThread: true } : null
}
