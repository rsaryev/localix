import { NotFoundError } from '../../../lib/domain-errors'
import { builtinAgentId, type AgentDefinition } from '@localixai/agent/agents'
import { DEFAULT_AGENT_NAME } from '../../../db/author'
import type { ModelRoute, SessionAgentRoute } from '../repository-types'

/** A name is accepted only when choosing a new assignment. An ID is never a name. */
export type SessionAgentSelection =
  | { agentId: string; name?: string }
  | { name: string; agentId?: undefined }

/**
 * Resolve a selection to an agent that may actually take part.
 *
 * `host` is the invocation the session is FOR — `'chat'` for a conversation, absent for the
 * sessions an engine creates for its own workers. Without it a task agent whose chat invocation is
 * denied could start a conversation and would fail on its first turn.
 */
export type ResolveSessionAgent = (
  userId: string,
  selection: SessionAgentSelection,
  projectId: string | null,
  host?: string,
) => Promise<Pick<AgentDefinition, 'id' | 'name'> | null>

export type ResolvedSessionAgent = Pick<SessionAgentRoute, 'agentId' | 'name'> & Partial<ModelRoute>

/** Standalone hosts know only the main loop. No filesystem or name fallback for IDs. */
const resolveBuiltin: ResolveSessionAgent = async (_userId, selection) => {
  const main = { id: builtinAgentId(DEFAULT_AGENT_NAME), name: DEFAULT_AGENT_NAME }
  if (selection.agentId !== undefined) return selection.agentId === main.id ? main : null
  return selection.name.toLowerCase() === main.name ? main : null
}

/** Resolve before persistence; the result is the one agent the session is born with. */
export async function resolveSessionAgent(args: {
  userId: string
  projectId: string | null
  requested?: SessionAgentSelection & Partial<ModelRoute>
  resolve?: ResolveSessionAgent
  /** The invocation this session is for; see {@link ResolveSessionAgent}. */
  host?: string
}): Promise<ResolvedSessionAgent> {
  const selection = args.requested ?? { agentId: builtinAgentId(DEFAULT_AGENT_NAME) }
  const resolve = args.resolve ?? resolveBuiltin
  const definition = await resolve(args.userId, selection, args.projectId, args.host)
  if (!definition) throw new NotFoundError('agent_unavailable', 'Selected agent is unavailable')
  return {
    agentId: definition.id,
    name: definition.name,
    ...(selection.providerConnectionId !== undefined
      ? { providerConnectionId: selection.providerConnectionId }
      : {}),
    ...(selection.modelId !== undefined ? { modelId: selection.modelId } : {}),
    ...(selection.reasoningEffort !== undefined
      ? { reasoningEffort: selection.reasoningEffort }
      : {}),
  }
}
