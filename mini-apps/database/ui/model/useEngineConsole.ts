import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import type { DbDialect } from '../dbClient'
import { useConsoleMessageContext } from './useConsoleMessageContext'
import { useDbConsoleCommands } from './useDbConsoleCommands'
import { useSqlConsole, type SqlConsoleState } from './useSqlConsole'
import { useSqlHistory } from './useSqlHistory'

/**
 * What every console tab is, whatever its engine: a run lifecycle, a history, a draft keyed by
 * THIS tab, live context for the chat, and "open this object" from the sidebar.
 *
 * Four tabs (SQL, Mongo, Redis, Elasticsearch) restated this, and the copies drifted: three of
 * them keyed the draft by the CONNECTION, so two consoles on one connection typed into one shared
 * draft, and they never passed the connection label, so their Output log had no `<db>>` prompt.
 */
export function useEngineConsole(input: {
  connectionId: string
  /** The console's own WorkItem id — its draft belongs to this tab, not to the connection. */
  consoleId: string
  dbLabel?: string
  dialect?: DbDialect
  /** What the draft is called in the chat: "SQL draft", "search draft"… */
  draftNoun: string
  language: string
  /** Runs after each successful execution, beside recording it in the history. */
  onExecuted?: (text: string) => void
  /**
   * The sidebar asked to open an object (table / collection / index / key). Absent when the tab
   * subscribes itself — the SQL console's handler depends on navigation state built after this.
   */
  onOpenObject?: (name: string, schema: string | undefined, console: SqlConsoleState) => void
  publishMessageContext?: PublishMessageContext
}) {
  const label = input.dbLabel ?? input.connectionId
  const history = useSqlHistory(input.connectionId)
  const { onExecuted } = input
  const consoleState = useSqlConsole(input.connectionId, {
    onExecuted: (text) => {
      history.record(text)
      onExecuted?.(text)
    },
    dialect: input.dialect,
    draftKey: input.consoleId,
    dbLabel: input.dbLabel,
  })
  useConsoleMessageContext({
    text: consoleState.sql,
    label: `${label} ${input.draftNoun}`,
    language: input.language,
    tabs: consoleState.tabs,
    activeTabId: consoleState.activeTabId,
    connectionLabel: label,
    publishMessageContext: input.publishMessageContext,
  })
  // Only `open-table` means something to every engine; column insertion and set-query are the
  // SQL console's, which subscribes itself.
  useDbConsoleCommands(input.connectionId, (cmd) => {
    if (cmd.kind === 'open-table') input.onOpenObject?.(cmd.table, cmd.schema, consoleState)
  })
  return { history, consoleState }
}
