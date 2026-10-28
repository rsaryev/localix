import { useMemo, useState } from 'react'
import { ChevronsDownUp, Plus, Search } from 'lucide-react'
import { ProblemLine, ProblemState } from '@localixai/mini-app-sdk/ui/components'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { PanelHeader } from '@localixai/kit/panel-header'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { SearchInput } from '@localixai/kit/search-input'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { connectionDisplayName } from '../../model/connectionDisplayName'
import { DIALECT_LABEL } from '../../model/dialects'
import { useDbProblem } from '../../problems'
import { CreateTableDialog } from '../CreateTableDialog'
import { DdlPreviewDialog } from '../schema-tree/DdlPreviewDialog'
import { SchemaTree } from '../schema-tree/SchemaTree'
import { ConnectionProblemOwner } from './ConnectionProblems'
import { openConsoleFor, type ExplorerState } from './connectionMenuEntries'
import { useConnectionsTree } from './useConnectionsTree'

/** The connections root: saved connections as one windowed tree, with their objects inline. */
export function ConnectionsTree({ s }: { s: ExplorerState }) {
  const [searchVisible, setSearchVisible] = useState(false)
  const listProblem = useDbProblem('saved connections', s.listError, {
    consequence: s.connections.length === 0 ? 'blocked' : 'stale',
    actions: [{ id: 'retry', label: 'Retry', run: s.refreshList }],
  })
  const removeProblem = useDbProblem('this connection', s.removeError)
  const [filter, setFilter] = useState('')
  const connections = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase()
    return [...s.connections]
      .filter(
        (connection) =>
          !query ||
          connectionDisplayName(connection).toLocaleLowerCase().includes(query) ||
          DIALECT_LABEL[connection.dialect].toLocaleLowerCase().includes(query),
      )
      .sort((a, b) =>
        connectionDisplayName(a).localeCompare(connectionDisplayName(b), undefined, {
          sensitivity: 'base',
        }),
      )
  }, [filter, s.connections])
  const tree = useConnectionsTree(s, connections)

  // No `bg-sidebar` coat: the host's sidebar panel is the outermost painter of that ground, and
  // under the macOS glass theme the token carries alpha — a second pane-sized coat compounds into
  // an opaque slab, and a mini app ground nested in the host's is exactly how this pane went black.
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* `content` tone throughout: this tree is the body of a work-item pane, not the host's
          sidebar — every workspace navigator draws its seams on the content seam. */}
      <PanelHeader
        tone="content"
        title="Connections"
        actions={
          <>
            <IconButton
              size="sm"
              aria-label={searchVisible ? 'Hide connection search' : 'Search connections'}
              tooltip={searchVisible ? 'Hide search' : 'Search connections'}
              tooltipSide="bottom"
              aria-pressed={searchVisible}
              className={searchVisible ? 'text-foreground' : undefined}
              onClick={() => {
                setSearchVisible((value) => !value)
                if (searchVisible) setFilter('')
              }}
            >
              <Search className="size-3.5" />
            </IconButton>
            <IconButton
              size="sm"
              aria-label="Collapse all connections"
              tooltip="Collapse all"
              tooltipSide="bottom"
              onClick={tree.collapseAll}
            >
              <ChevronsDownUp className="size-3.5" />
            </IconButton>
            <RefreshAction
              size="sm"
              aria-label="Refresh connections"
              tooltip="Refresh connections"
              tooltipSide="bottom"
              onClick={s.refreshList}
              disabled={s.loading}
              busy={s.loading}
            />
            <IconButton
              size="sm"
              aria-label="New connection"
              tooltip="New connection"
              tooltipSide="bottom"
              onClick={() => {
                s.setEditingConfig(null)
                s.setAdding(true)
              }}
            >
              <Plus className="size-3.5" />
            </IconButton>
          </>
        }
      />

      {searchVisible && (
        <WorkbenchToolbar
          density="compact"
          aria-label="Connection filter controls"
          className="px-2"
        >
          <SearchInput
            value={filter}
            onValueChange={setFilter}
            placeholder="Filter connections…"
            aria-label="Search saved connections"
            // oxlint-disable-next-line jsx-a11y/no-autofocus -- SearchInput's own prop: it focuses the field by hand on mount, no DOM autofocus attribute is set
            autoFocus
            size="md"
            inset
            className="min-w-0 flex-1"
          />
        </WorkbenchToolbar>
      )}

      {listProblem && s.connections.length > 0 && (
        <ProblemLine {...listProblem} className="shrink-0 px-2 py-1" />
      )}
      {removeProblem && <ProblemLine {...removeProblem} className="shrink-0 px-2 py-1" />}

      {s.loading && s.connections.length === 0 ? (
        <LoadingHint className="flex-1">Loading connections…</LoadingHint>
      ) : listProblem && s.connections.length === 0 ? (
        <ProblemState {...listProblem} />
      ) : (
        <SchemaTree rows={tree.rows} actions={tree.actions} ariaLabel="Database connections">
          {connections.length === 0 && filter && (
            <EmptyHint className="p-3">No connections match “{filter.trim()}”.</EmptyHint>
          )}
        </SchemaTree>
      )}

      {s.connections.map((connection) => (
        <ConnectionProblemOwner
          key={connection.id}
          connection={connection}
          reconnectError={s.reconnectError[connection.id]}
          retryConnect={tree.retryConnect}
          reader={tree.readers.get(connection.id)}
          onLines={tree.reportLines}
        />
      ))}
      <DdlPreviewDialog
        target={tree.ddl.target}
        reader={tree.ddl.target ? tree.readers.get(tree.ddl.target.connectionId) : undefined}
        dialect={tree.ddlConnection?.dialect ?? 'postgres'}
        onClose={tree.ddl.close}
      />
      {tree.createTarget && (
        <CreateTableDialog
          key={`${tree.createTarget.connection.id}:${tree.createTarget.schemaName}`}
          open
          connection={tree.createTarget.connection}
          schemas={Object.keys(tree.readers.get(tree.createTarget.connection.id)?.schemas ?? {})}
          initialSchema={tree.createTarget.schemaName}
          onOpenChange={(open) => {
            if (!open) tree.closeCreate()
          }}
          onOpenSql={(sql) => openConsoleFor(s.sessionId, tree.createTarget!.connection, sql)}
        />
      )}
    </div>
  )
}
