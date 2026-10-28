import { backendClient } from '@/shared/api/client'
import type { ProviderConnection } from '@/shared/api/contracts'
import { resourceSync } from '@/shared/api/resourceSync'
import { useChatStore } from './store'

/**
 * The one writer of `connections` in the chat store (P12). The realtime 'providers' topic re-reads
 * after every server-side connection change; `refreshConnections` is only for a caller that must
 * see the new list before it goes on (an OAuth flow binding the connection it just created).
 *
 * Every read takes a ticket when it starts, and an answer lands only when no read that started
 * later has landed already, so a slow stale answer can never overwrite a newer one.
 */
let issued = 0
let applied = 0

interface ConnectionsRead {
  ticket: number
  connections: ProviderConnection[]
}

async function readConnections(signal?: AbortSignal): Promise<ConnectionsRead> {
  const ticket = ++issued
  return { ticket, connections: await backendClient.listConnections(signal) }
}

function applyConnections({ ticket, connections }: ConnectionsRead): void {
  if (ticket < applied) return
  applied = ticket
  useChatStore.setState({ connections })
}

/** Register the topic adapter. Each window registers it once. */
export function registerConnectionsSync(onError?: (error: unknown) => void): () => void {
  return resourceSync.register('providers', {
    read: readConnections,
    apply: applyConnections,
    onError: onError ?? ((error) => console.warn('[realtime] provider sync failed', error)),
  })
}

/** Read the connections now and wait for the answer; a newer read that lands first wins. */
export async function refreshConnections(): Promise<void> {
  applyConnections(await readConnections())
}
