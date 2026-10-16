import { builtinAgentId, isHumanAgent, type AgentDefinition } from '@localixai/agent/agents'
import { ApiError } from '../../../lib/errors'
import { DEFAULT_AGENT_HANDLE } from '../../../db/participant'
import { builtinAgentRecord } from '../../agents/builtin'
import type { ModelRoute, SessionAgentRoute } from '../repository-types'

/** A handle is accepted only when choosing a new assignment. An ID is never a handle. */
export type SessionAgentSelection =
  | { agentId: string; handle?: string }
  | { handle: string; agentId?: undefined }

/**
 * Resolve a selection to an agent that may actually take part.
 *
 * `host` is the invocation the session is FOR — `'chat'` for a conversation, absent for the
 * sessions an engine creates for its own workers. Without it a task agent whose chat invocation is
 * denied could be seated in a conversation and would fail on its first turn, in its own voice, as
 * if the failure were its answer: observed in a room, where the other members then read the policy
 * error as a colleague's contribution.
 */
export type ResolveSessionAgent = (
  userId: string,
  selection: SessionAgentSelection,
  projectId: string | null,
  host?: string,
) => Promise<Pick<AgentDefinition, 'id' | 'handle'> | null>

export type ResolvedSessionAgent = Pick<SessionAgentRoute, 'agentId' | 'handle'> &
  Partial<ModelRoute>

/** Standalone hosts have only shipped definitions. No filesystem or handle fallback for IDs. */
const resolveBuiltin: ResolveSessionAgent = async (_userId, selection) => {
  if (selection.agentId !== undefined) {
    const prefix = 'builtin:'
    if (!selection.agentId.startsWith(prefix)) return null
    const record = runnableBuiltin(selection.agentId.slice(prefix.length))
    return record?.id === selection.agentId ? record : null
  }
  return runnableBuiltin(selection.handle)
}

/** The person's record is shipped too, but it is never a session's participant. */
const runnableBuiltin = (handle: string) => {
  const record = builtinAgentRecord(handle)
  return record && !isHumanAgent(record) ? record : null
}

/** Resolve before persistence; existing participants retain their historical snapshots on edit. */
export async function resolveSessionParticipants(args: {
  userId: string
  projectId: string | null
  requested?: readonly (SessionAgentSelection & Partial<ModelRoute>)[]
  existing?: readonly SessionAgentRoute[]
  resolve?: ResolveSessionAgent
  /** The invocation this session is for; see {@link ResolveSessionAgent}. */
  host?: string
}): Promise<ResolvedSessionAgent[]> {
  const selections = args.requested ?? [{ agentId: builtinAgentId(DEFAULT_AGENT_HANDLE) }]
  const resolve = args.resolve ?? resolveBuiltin
  const participants: ResolvedSessionAgent[] = []
  const seen = new Set<string>()
  for (const selection of selections) {
    const existing =
      selection.agentId !== undefined
        ? args.existing?.find((member) => member.agentId === selection.agentId)
        : undefined
    const definition = existing
      ? { id: existing.agentId, handle: existing.handle }
      : await resolve(args.userId, selection, args.projectId, args.host)
    if (!definition) throw new ApiError(404, 'agent_unavailable', 'Selected agent is unavailable')
    if (seen.has(definition.id))
      throw new ApiError(400, 'agent_duplicate', 'Agent is already a participant')
    seen.add(definition.id)
    participants.push({
      agentId: definition.id,
      handle: definition.handle,
      ...(selection.providerConnectionId !== undefined
        ? { providerConnectionId: selection.providerConnectionId }
        : {}),
      ...(selection.modelId !== undefined ? { modelId: selection.modelId } : {}),
      ...(selection.reasoningEffort !== undefined
        ? { reasoningEffort: selection.reasoningEffort }
        : {}),
    })
  }
  return participants
}
