/**
 * Where the agent's writes reach the workbench — `shared/database-changes.ts` says why this is a
 * push rather than a poll. Each change re-reads exactly the reader it moved, and only a reader
 * someone is showing: `schemaStore.invalidate` re-fetches a schema with subscribers and merely
 * forgets one without, and a hidden table page re-reads when it is next shown.
 *
 * Every session's frames count, not only the active chat's: connections and schemas belong to the
 * machine, so an agent working in a background chat still moves what the workbench shows.
 */
import { miniAppCommandBus } from '@localixai/mini-app-sdk/ui/commands'
import {
  DATABASE_CHANGES_CHANNEL,
  DATABASE_MINI_APP,
  parseDatabaseChange,
  type DatabaseChange,
} from '../../shared/database-changes'
import { getConnectionsSnapshot } from './connectionsStore'
import { schemaStore } from './schemaStore'
import { DATABASE_CONNECTIONS, DATABASE_DATA } from './topics'

/** No id means the call named no connection, so every connection it could have used moved. */
const affected = (connectionId?: string): string[] =>
  connectionId ? [connectionId] : getConnectionsSnapshot().connections.map(({ id }) => id)

export function applyDatabaseChange(change: DatabaseChange): void {
  switch (change.type) {
    case 'connections':
      DATABASE_CONNECTIONS.invalidate()
      return
    case 'schema':
      for (const id of affected(change.connectionId)) schemaStore.invalidate(id)
      // A DROP or an ALTER also moves the rows an open table page is showing.
      DATABASE_DATA.invalidate(change.connectionId)
      return
    case 'data':
      DATABASE_DATA.invalidate(change.connectionId)
  }
}

let registered = false

/** Once per page: the command bus keeps its sinks for the life of the app. */
export function initDatabaseChanges(): void {
  if (registered) return
  registered = true
  miniAppCommandBus.register(DATABASE_MINI_APP, DATABASE_CHANGES_CHANNEL, (event) => {
    const change = parseDatabaseChange(event.payload)
    if (change) applyDatabaseChange(change)
  })
}
