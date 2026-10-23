import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { useEngineConsole } from './model/useEngineConsole'
import { useSchema } from './model/useSchema'
import { DocConsole } from './ui/DocConsole'

/**
 * One MongoDB (document) connection's query console as an editor-grid tab — sibling of
 * DbConsoleTab/KvConsoleTab on the shared `useEngineConsole`; clicking a collection in the
 * sidebar runs its `find({})`.
 */
export function DocConsoleTab({
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
    draftNoun: 'document query draft',
    language: 'javascript',
    onOpenObject: (collection, _schema, console) =>
      void console.runText(`db.${collection}.find({})`),
    publishMessageContext,
  })
  const { model } = useSchema(connectionId)

  return (
    <DocConsole
      console={consoleState}
      connectionId={connectionId}
      dbLabel={dbLabel}
      history={history}
      methods={['find', 'findOne', 'aggregate', 'countDocuments', 'count', 'distinct']}
      collections={model.tables}
    />
  )
}
