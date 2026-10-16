import { useMemo } from 'react'

import {
  findCatalogModelForConnection,
  resolveLiveCatalogModel,
  type CatalogModel,
} from '@localixai/agent/catalog'
import type { ProviderConnection } from '@/shared/api/contracts'

interface RosterMember {
  modelId: string
  providerConnectionId: string | null
}

/** The composer's selected catalog model and the roster annotated with each member's window. */
export function useComposerModels<P extends RosterMember>(
  models: CatalogModel[],
  connections: ProviderConnection[],
  activeConnectionId: string | null | undefined,
  model: string,
  participants: readonly P[],
) {
  // Memoized so the linear catalog scan doesn't re-run on every keystroke.
  const selectedModel = useMemo(
    () => findCatalogModelForConnection(models, connections, activeConnectionId, model),
    [activeConnectionId, connections, model, models],
  )
  const rosterParticipants = useMemo(
    () =>
      participants.map((participant) => ({
        ...participant,
        contextWindow: resolveLiveCatalogModel(
          models,
          connections,
          participant.modelId,
          participant.providerConnectionId,
        )?.model.contextLength,
      })),
    [participants, models, connections],
  )
  return { selectedModel, rosterParticipants }
}
