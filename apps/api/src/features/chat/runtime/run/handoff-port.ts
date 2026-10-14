import type { HandoffPort } from '../../../agent-core/tools/handoff'
import type { RunTurnState } from './turn-state'
import type { RunEnv, RunParams } from './types'

/**
 * Records who this turn's reply gives the floor to; `routeConversationReply` acts on it once the
 * reply settles. Anyone present can be named, and so can an available agent when the room is open
 * (naming it invites it). Nobody else is: the model is told who is.
 */
export function createHandoffPort(
  env: Pick<RunEnv, 'deps'>,
  params: RunParams,
  state: Pick<RunTurnState, 'handoffs'>,
): HandoffPort {
  const { session, userId } = params
  return {
    async hand(requested) {
      const present = session.agents
        .filter((member) => member.agentId !== params.scope.speakerAgentId)
        .map((member) => member.handle)
      const invitable = session.rosterLocked
        ? []
        : ((await env.deps.listInvocableRegistryAgents?.(userId, 'chat', session.projectId)) ?? [])
            .filter((agent) => !session.agents.some((member) => member.agentId === agent.agentId))
            .map((agent) => agent.name)
      const available = [...present, ...invitable]
      const handed: string[] = []
      const unknown: string[] = []
      for (const raw of requested) {
        const wanted = raw.trim().replace(/^@/, '').toLowerCase()
        const handle = available.find((known) => known.toLowerCase() === wanted)
        if (!handle) unknown.push(raw)
        else if (!handed.includes(handle)) handed.push(handle)
      }
      for (const handle of handed) if (!state.handoffs.includes(handle)) state.handoffs.push(handle)
      return { handed, unknown, available }
    },
  }
}
