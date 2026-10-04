import type { ProviderConnection } from '@/shared/api/contracts'

type PollableConnection = Pick<ProviderConnection, 'id' | 'providerId' | 'updatedAt' | 'keyCount'>

const version = (connection: PollableConnection): string =>
  `${connection.id}:${connection.updatedAt}:${connection.keyCount}`

/**
 * Finds the connection created or updated by one OAuth flow. Comparing a stable
 * version instead of only the id lets re-authorization repair an existing
 * zero-key connection without rebinding the session to an unrelated provider.
 */
export function findChangedOAuthConnection<T extends PollableConnection>(
  baseline: readonly T[],
  current: readonly T[],
  providerId: string,
): T | undefined {
  const knownVersions = new Set<string>()
  for (const connection of baseline) {
    if (connection.providerId === providerId) knownVersions.add(version(connection))
  }
  return current.find(
    (connection) => connection.providerId === providerId && !knownVersions.has(version(connection)),
  )
}
