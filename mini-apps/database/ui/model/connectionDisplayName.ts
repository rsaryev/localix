import type { DbConnectionInfo } from '../dbClient'

/**
 * Older Localix builds used SQLite's driver sentinel as the automatic connection name.
 * Keep that implementation detail out of the UI while preserving an explicitly chosen name.
 */
export function connectionDisplayName(
  connection: Pick<DbConnectionInfo, 'dialect' | 'name'>,
): string {
  const normalized = connection.name.trim().toLocaleLowerCase()
  if (
    connection.dialect === 'sqlite' &&
    (normalized === ':memory' ||
      normalized === ':memory:' ||
      normalized === ':inmemory' ||
      normalized === ':inmemory:')
  ) {
    return 'In-memory SQLite'
  }
  return connection.name
}
