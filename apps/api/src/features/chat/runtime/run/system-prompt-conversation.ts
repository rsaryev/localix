/**
 * The conversation half of a run's system prompt: whether a person's conversation surrounds the
 * run, and which agents `Agent` can hand a task to.
 *
 * Its own module because each question it answers is one line of the prompt builder's call and
 * none of its business otherwise — the builder composes sections, it does not know what a
 * session's policy is.
 */
import type { RunPolicy } from '../../policy/run-policy'

/**
 * The run answers a person in a conversation (`policy.conversation.kind === 'chat'`); a
 * delegated child or a job works for whoever started it, so no conversation surrounds it.
 */
export function conversationPromptContext(policy: Pick<RunPolicy, 'conversation'>): boolean {
  return policy.conversation.kind === 'chat'
}

/** One registered agent, as the prompt's directory lists it. */
export interface AgentDirectoryEntry {
  agentId: string
  name: string
  description: string
  enabled: boolean
  /** `Agent` can hand it a task. */
  delegable?: boolean
  tools?: readonly string[]
  self?: boolean
}

/**
 * The agents `Agent` can hand a task to. Nothing when the run cannot delegate.
 */
export function agentDirectoryRows(
  directory: readonly AgentDirectoryEntry[] | undefined,
  opts: { canDelegate: boolean } = { canDelegate: false },
) {
  if (!opts.canDelegate) return undefined
  return (directory ?? [])
    .filter((agent) => agent.delegable)
    .map((agent) => ({
      id: agent.agentId,
      name: agent.name,
      description: agent.description,
      ...(agent.tools ? { tools: agent.tools } : {}),
      ...(agent.self ? { self: true } : {}),
    }))
}
