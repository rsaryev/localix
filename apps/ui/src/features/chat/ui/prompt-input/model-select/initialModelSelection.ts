import type { ProviderConnection } from '@/shared/api/contracts'
import type { SelectedItem } from './ModelSelectSidebar'

interface InitialSelectionInput {
  connections: readonly Pick<ProviderConnection, 'id' | 'providerId'>[]
  unconnectedProviders: readonly { id: string }[]
  initialConnectionId?: string
  initialProviderId?: string
  currentLiveConnectionId?: string
  activeId: string | null
}

/**
 * The sidebar row the browser opens on, in preference order: the requested connection or
 * provider, the target's live connection, the active connection, the newest connection, then the
 * first connectable provider. `null` = no data yet (the caller retries on the next render).
 */
export function initialModelSelection({
  connections,
  unconnectedProviders,
  initialConnectionId,
  initialProviderId,
  currentLiveConnectionId,
  activeId,
}: InitialSelectionInput): SelectedItem {
  const preferredConnection = initialConnectionId
    ? connections.find((connection) => connection.id === initialConnectionId)
    : initialProviderId
      ? connections.find((connection) => connection.providerId === initialProviderId)
      : undefined
  const preferredProvider = initialProviderId
    ? unconnectedProviders.find((provider) => provider.id === initialProviderId)
    : undefined
  if (preferredConnection) return { type: 'connection', id: preferredConnection.id }
  if (preferredProvider) return { type: 'provider', id: preferredProvider.id }
  if (currentLiveConnectionId) return { type: 'connection', id: currentLiveConnectionId }
  if (activeId && connections.some((c) => c.id === activeId))
    return { type: 'connection', id: activeId }
  if (connections.length > 0) return { type: 'connection', id: connections.at(-1)!.id }
  if (unconnectedProviders.length > 0) return { type: 'provider', id: unconnectedProviders[0]!.id }
  return null
}
