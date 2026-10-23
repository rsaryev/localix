import { Search } from 'lucide-react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { useEngineConsole } from './model/useEngineConsole'
import { useSchema } from './model/useSchema'
import { DocConsole } from './ui/DocConsole'

/**
 * One Elasticsearch (search) connection's console as an editor-grid tab: the shared JSON command
 * console (DocConsole) with search presentation, on the shared `useEngineConsole`; clicking an
 * index in the sidebar runs its `search({})`.
 */
export function EsConsoleTab({
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
    draftNoun: 'search draft',
    language: 'javascript',
    onOpenObject: (index, _schema, console) =>
      void console.runText(`${index}.search({"query":{"match_all":{}}})`),
    publishMessageContext,
  })
  const { model } = useSchema(connectionId)

  return (
    <DocConsole
      console={consoleState}
      connectionId={connectionId}
      dbLabel={dbLabel}
      history={history}
      icon={Search}
      placeholder={'products.search({"query":{"match_all":{}}})   ·   ⌘/Ctrl+Enter to run'}
      historyLabel="Recent searches"
      emptyHint="Run a search to see hits."
      methods={['search', 'count', 'get']}
      collections={model.tables}
    />
  )
}
