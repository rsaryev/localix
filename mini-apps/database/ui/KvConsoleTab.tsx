import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { databaseApi } from './api/databaseApi'
import { parseRedisType, readCommandForType, redisTouchesKeyspace } from './model/kvRead'
import { schemaStore } from './model/schemaStore'
import type { SqlConsoleState } from './model/useSqlConsole'
import { useEngineConsole } from './model/useEngineConsole'
import { KvConsole } from './ui/KvConsole'

/** Open a key: look up its TYPE, then run the type's whole-value read (GET / LRANGE / HGETALL…) —
 *  Redis cannot run the `SELECT *` the SQL tab uses. A failed TYPE probe falls back to GET. */
async function openKey(connectionId: string, key: string, console: SqlConsoleState) {
  try {
    const res = await databaseApi.query(connectionId, `TYPE ${JSON.stringify(key)}`)
    await console.runText(readCommandForType(parseRedisType(res.rows[0]?.[0]), key))
  } catch {
    await console.runText(readCommandForType('none', key))
  }
}

/**
 * One Redis (kv) connection's command console as an editor-grid tab — the non-SQL sibling of
 * DbConsoleTab on the shared `useEngineConsole`. A command that may add or remove keys refreshes
 * the keyspace tree, as SQL refreshes the schema after DDL.
 */
export function KvConsoleTab({
  connectionId,
  consoleId,
  dbLabel,
  publishMessageContext,
}: {
  connectionId: string
  /** This tab's WorkItem id — keys its own draft. */
  consoleId: string
  /** The tab's own title — what a person calls this console, and how its failures are filed. */
  dbLabel?: string
  publishMessageContext?: PublishMessageContext
}) {
  const { history, consoleState } = useEngineConsole({
    connectionId,
    consoleId,
    dbLabel,
    draftNoun: 'command draft',
    language: 'text',
    onExecuted: (cmd) => {
      if (redisTouchesKeyspace(cmd)) schemaStore.reload(connectionId)
    },
    onOpenObject: (key, _schema, console) => void openKey(connectionId, key, console),
    publishMessageContext,
  })

  return (
    <KvConsole
      console={consoleState}
      connectionId={connectionId}
      dbLabel={dbLabel}
      history={history}
    />
  )
}
