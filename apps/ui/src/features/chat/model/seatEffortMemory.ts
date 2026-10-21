import { setAgentModelSettings } from '@localixai/agent'
import { useUserSettings } from '@/shared/lib/user-settings/useUserSettings'
import type { ReasoningEffort } from './reasoning'

/**
 * THE ONE MEMORY OF "WHICH LEVEL FOR THIS AGENT ON THIS MODEL" (`agentModelSettings`).
 *
 * Written whenever a participant's seat gets a level — a pick, the composer, the details panel —
 * so the next time that agent starts on that model (a new chat, an invitation, a re-pick) the
 * server's `birthRoute` and the picker both read the same answer. Nothing else is remembered:
 * no "last level used for anything", no level carried from another model or participant.
 */
export function rememberSeatEffort(entry: {
  agentId: string
  providerId: string
  modelId: string
  effort: ReasoningEffort
}): void {
  const { settings, update } = useUserSettings.getState()
  const base = settings.agentSettings ?? {}
  const current = base.agentModelSettings?.find(
    (row) =>
      row.agentId === entry.agentId &&
      row.providerId === entry.providerId &&
      row.modelId === entry.modelId,
  )
  if (current?.effort === entry.effort) return
  update({
    agentSettings: {
      ...base,
      agentModelSettings: setAgentModelSettings(base.agentModelSettings, entry),
    },
  })
}

/** The provider a seat's model is reached through: its connection's, else its namespace. */
export function seatProviderId(
  connections: readonly { id: string; providerId: string }[],
  connectionId: string | null | undefined,
  modelId: string,
): string | undefined {
  const fromConnection = connections.find((connection) => connection.id === connectionId)
  if (fromConnection) return fromConnection.providerId
  const slash = modelId.indexOf('/')
  return slash > 0 ? modelId.slice(0, slash) : undefined
}
