import { isHumanAgent, type AgentKind } from '@localixai/agent/agents'
import { canJoinConversation } from '@localixai/api/agent-policy'
import type {
  AgentSummary,
  JoinRoutesView,
  SessionAgentRoute,
  SessionModelChoicesView,
} from '@/shared/api/contracts'
import { choiceFor } from '../../../model/sessionModelChoices'
import type { ParticipantRow } from './ModelTaskColumn'

/** The registry facts a participant row shows: its name, turn ceiling and own model. */
export interface ParticipantRecord {
  label?: string
  kind?: AgentKind
  limits?: { maxTurns?: number }
  modelPreference?: { model?: string }
}

/** The registry facts a row needs about the agent itself, whoever it routes. */
function recordFields(agentId: string, handle: string, record: ParticipantRecord | undefined) {
  return {
    agentId,
    ...(record?.limits?.maxTurns ? { maxTurnsLimit: record.limits.maxTurns } : {}),
    handle,
    // A handle the registry cannot resolve still gets a row: the conversation is with
    // someone, and hiding them would make the picker disagree with the transcript.
    ...(record?.label ? { label: record.label } : {}),
    ...(record?.modelPreference?.model
      ? { inheritedLabel: `Use ${record.modelPreference.model}` }
      : {}),
  }
}

/**
 * The picker's Agents column rows — one builder for the picker and `/model`, so both name and
 * route every agent the same way.
 *
 * The participants first, each on its seat as the server resolved it. Then, when the registry is
 * given, every other agent that could join this conversation (never the person's own `@human`
 * record), each on the session's choice for it, else what it would join on — its card, else its
 * last pick, else the project (`joinRoutes`, from the server's model chain).
 */
export function participantRows(
  participants: readonly SessionAgentRoute[] | undefined,
  recordFor: (agentId: string) => ParticipantRecord | undefined,
  invitable?: {
    agents: readonly Pick<AgentSummary, 'record' | 'enabled' | 'invocations'>[]
    choices: SessionModelChoicesView | undefined
    joinRoutes?: JoinRoutesView | null
  },
): ParticipantRow[] {
  const seated = (participants ?? []).map((member): ParticipantRow => ({
    ...recordFields(member.agentId, member.handle, recordFor(member.agentId)),
    // What this member actually runs on, already resolved through the chain by the server —
    // its level included, so the picker answers for the member it is pointed at.
    route: {
      providerConnectionId: member.providerConnectionId,
      modelId: member.modelId,
      ...(member.reasoningEffort ? { reasoningEffort: member.reasoningEffort } : {}),
    },
    ...(member.modelOrigin ? { modelOrigin: member.modelOrigin } : {}),
  }))
  const seatedIds = new Set(seated.map((row) => row.agentId))
  const others = (invitable?.agents ?? [])
    .filter(
      (agent) =>
        !seatedIds.has(agent.record.id) &&
        !isHumanAgent(agent.record) &&
        canJoinConversation(agent),
    )
    .map((agent): ParticipantRow => {
      const choice =
        choiceFor(invitable?.choices, agent.record.id) ??
        invitable?.joinRoutes?.agents[agent.record.id] ??
        invitable?.joinRoutes?.fallback ??
        null
      return {
        ...recordFields(agent.record.id, agent.record.handle, agent.record),
        invited: false,
        ...(choice ? { route: choice } : {}),
      }
    })
  return [...seated, ...others]
}
