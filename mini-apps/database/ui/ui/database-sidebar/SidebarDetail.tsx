import { Plug, Database } from 'lucide-react'
import type { Problem } from '@localixai/mini-app-sdk/ui/problems'
import { StateNotice } from '@localixai/kit/state-notice'
import type { DbConnectionInfo } from '../../dbClient'
import type { DbTableOpenMode } from '../../model/openConsole'
import type { useSchema } from '../../model/useSchema'
import { SchemaSidebar } from '../SchemaSidebar'
import { ReconnectCard, useReconnectProblem } from '../ReconnectCard'

interface SidebarDetailProps {
  selected: DbConnectionInfo | null
  schema: ReturnType<typeof useSchema>
  reconnecting: Record<string, boolean>
  reconnectError: Record<string, Problem | undefined>
  onOpenTable: (table: string, schema?: string, mode?: DbTableOpenMode) => void
  onInsertColumn: (column: string) => void
  onRetry: (conn: DbConnectionInfo) => void
  onRemove: (id: string) => void
}

/** Detail area under the connection list: schema browser for a live selection, else the
 *  reconnect card; a hint when nothing is selected. */
export function SidebarDetail({
  selected,
  schema,
  reconnecting,
  reconnectError,
  onOpenTable,
  onInsertColumn,
  onRetry,
  onRemove,
}: SidebarDetailProps) {
  // The card below exists only while the connection is down; this detail area survives the
  // reconnect, so it is what owns the failed attempt and settles it once one succeeds.
  const reconnectProblem = useReconnectProblem(
    selected,
    !!(selected && reconnecting[selected.id]),
    selected ? reconnectError[selected.id] : undefined,
    () => {
      if (selected) onRetry(selected)
    },
    () => {
      if (selected) onRemove(selected.id)
    },
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {selected ? (
        selected.connected ? (
          <SchemaSidebar
            connection={selected}
            schema={schema}
            onOpenTable={onOpenTable}
            onInsertColumn={onInsertColumn}
          />
        ) : (
          <ReconnectCard
            connection={selected}
            error={reconnectError[selected.id]}
            problem={reconnectProblem}
          />
        )
      ) : (
        // The host's pane-level empty state, like the reconnect state beside it.
        <StateNotice
          icon={Database}
          title="No connection selected"
          body={
            <>
              Select a connection to browse its schema, or add one with{' '}
              <span className="inline-flex items-center gap-1 text-text-soft">
                <Plug className="size-3" /> New connection
              </span>
            </>
          }
        />
      )}
    </div>
  )
}
