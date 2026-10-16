import type { SessionAgentRoute } from '@/shared/api/contracts'
import type { ParticipantRow } from './ModelTaskColumn'

/** The registry facts a participant row shows: its name, turn ceiling and own model. */
export interface ParticipantRecord {
  label?: string
  limits?: { maxTurns?: number }
  modelPreference?: { model?: string }
}

/**
 * The picker's Agents column rows, from the conversation's party and the registry — one builder
 * for the picker and `/model`, so both name and route every member the same way.
 */
export function participantRows(
  participants: readonly SessionAgentRoute[] | undefined,
  recordFor: (agentId: string) => ParticipantRecord | undefined,
): ParticipantRow[] {
  return (participants ?? []).map((member) => {
    const record = recordFor(member.agentId)
    return {
      agentId: member.agentId,
      ...(record?.limits?.maxTurns ? { maxTurnsLimit: record.limits.maxTurns } : {}),
      handle: member.handle,
      // A handle the registry cannot resolve still gets a row: the conversation is with
      // someone, and hiding them would make the picker disagree with the transcript.
      ...(record?.label ? { label: record.label } : {}),
      ...(record?.modelPreference?.model
        ? { inheritedLabel: `Use ${record.modelPreference.model}` }
        : {}),
      // What this member actually runs on, already resolved through the chain by the server —
      // its level included, so the picker answers for the member it is pointed at.
      route: {
        providerConnectionId: member.providerConnectionId,
        modelId: member.modelId,
        ...(member.reasoningEffort ? { reasoningEffort: member.reasoningEffort } : {}),
      },
      ...(member.modelOrigin ? { modelOrigin: member.modelOrigin } : {}),
    }
  })
}
