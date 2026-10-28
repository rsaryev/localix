/**
 * The API workspace's NAVIGATOR: the saved requests, filterable, sortable, groupable.
 *
 * It selects, it does not navigate. Choosing a row moves the workspace's request/response panes
 * onto it so the list and edited request stay visible together. Opening a request in its own grid
 * tab remains an explicit row action, matching the database mini app's SQL-console behavior.
 *
 * "+" mints a request (or imports one from pasted cURL) and selects it; row actions duplicate,
 * rename, or delete. Sort and group choices persist per browser. The state ladder is loading →
 * error → empty → content.
 */

import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { PanelHeader } from '@localixai/kit/panel-header'
import { StateNotice } from '@localixai/kit/state-notice'
import { ApiProblem } from './problems'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { Button } from '@localixai/kit/button'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { SearchInput } from '@localixai/kit/search-input'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { saveJSON } from '@localixai/mini-app-sdk/ui/storage'
import type { RequestInfo } from '../backend/contracts'
import type { useEnvironments } from './model/useEnvironments'
import { useRequests, type RequestsState } from './model/useRequests'
import { useRequestActions } from './model/useRequestActions'
import { filterRequests, GROUP_MODES, persisted, SORT_MODES } from './model/sidebarModes'
import { RequestsHeaderActions } from './ui/RequestsHeaderActions'
import { ImportDialog } from './ui/ImportDialog'
import { NewFolderDialog } from './ui/NewFolderDialog'
import { openRestRequestTab } from './model/openTab'
import { groupKey, sortRequests, type GroupMode, type SortMode } from './model/sortRequests'
import { restApi } from './restApi'
import { RequestRow } from './ui/RequestRow'
import { RequestTree } from './ui/RequestTree'

export function RestApiSidebar({
  sessionId,
  activeName,
  onSelect,
  environments: environmentState,
  onManageEnvironments,
  onRequestsStateChange,
}: {
  /** The chat whose project's collection this lists — the workspace tab's session. */
  sessionId: string
  /** The request the workspace is showing — the row that reads as selected. */
  activeName?: string
  /** Move the workspace onto a request. Every path that MINTS one selects it too. */
  onSelect: (name?: string) => void
  environments: ReturnType<typeof useEnvironments>
  onManageEnvironments: () => void
  /** Reuse the navigator's single fetch stream for workspace-level agent context. */
  onRequestsStateChange?: (state: RequestsState) => void
}) {
  const { requests, folders, loading, error, refresh } = useRequests(sessionId)
  const { refresh: refreshEnvironments } = environmentState
  const [filter, setFilter] = useState('')
  const [importOpen, setImportOpen] = useState(false)

  useEffect(() => {
    onRequestsStateChange?.({ requests, folders, loading, error })
  }, [error, folders, loading, onRequestsStateChange, requests])

  // Files can disappear outside this pane (agent/delete, git update, editor). Never leave the
  // request half pointing at a raw `request_not_found` after the navigator has reconciled.
  useEffect(() => {
    if (
      !loading &&
      !error &&
      activeName &&
      !requests.some((request) => request.name === activeName)
    )
      onSelect(undefined)
  }, [activeName, error, loading, onSelect, requests])

  // Ordering + grouping the panel remembers between visits (per browser).
  const [sort, setSortState] = useState<SortMode>(() => persisted('api.sort', SORT_MODES, 'name'))
  const [group, setGroupState] = useState<GroupMode>(() =>
    persisted('api.group', GROUP_MODES, 'folder'),
  )
  const setSort = (v: SortMode) => {
    setSortState(v)
    saveJSON('api.sort', v)
  }
  const setGroup = (v: GroupMode) => {
    setGroupState(v)
    saveJSON('api.group', v)
  }

  const shown = useMemo(
    () => sortRequests(filterRequests(requests, filter), sort),
    [requests, filter, sort],
  )

  // Bucket the already-sorted list, then order the headings alphabetically so the section list is
  // stable and scannable regardless of the within-group sort.
  const groups = useMemo(() => {
    if (group === 'none' || group === 'folder') return null
    const map = new Map<string, RequestInfo[]>()
    for (const r of shown) {
      const key = groupKey(r, group)
      const bucket = map.get(key)
      if (bucket) bucket.push(r)
      else map.set(key, [r])
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [shown, group])

  const {
    creating,
    confirmDelete,
    setConfirmDelete,
    pending,
    actionError,
    folderParent,
    setFolderParent,
    folderName,
    setFolderName,
    createNew,
    createFolder,
    removeFolder,
    remove,
    manage,
  } = useRequestActions({
    sessionId,
    requests,
    activeName,
    onSelect,
    refresh,
    onFolderCreated: () => setGroup('folder'),
  })

  const renderRow = (request: RequestInfo, displayName?: string) => (
    <RequestRow
      key={request.name}
      sessionId={sessionId}
      request={request}
      displayName={displayName}
      busy={!!pending[request.name]}
      active={request.name === activeName}
      onOpen={() => onSelect(request.name)}
      onOpenInTab={() => openRestRequestTab(sessionId, request.name)}
      onDelete={() => setConfirmDelete(request.name)}
      onDuplicate={() =>
        manage(request.name, () =>
          restApi.duplicate(sessionId, request.name).then((dup) => {
            onSelect(dup.name)
          }),
        )
      }
      onRename={(to) =>
        manage(request.name, () =>
          restApi.rename(sessionId, request.name, to).then((renamed) => {
            if (activeName === request.name) onSelect(renamed.name)
          }),
        )
      }
    />
  )

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        title="Requests"
        tone="content"
        summary={
          !loading && !error && requests.length > 0 ? (
            <span className="text-2xs font-normal text-text-faint tabular-nums">
              {shown.length}
            </span>
          ) : null
        }
        actions={
          <RequestsHeaderActions
            environments={environmentState}
            onManageEnvironments={onManageEnvironments}
            createNew={() => createNew()}
            setFolderParent={setFolderParent}
            setImportOpen={setImportOpen}
            sort={sort}
            setSort={setSort}
            group={group}
            setGroup={setGroup}
            refresh={refresh}
          />
        }
      />
      <WorkbenchToolbar density="compact" aria-label="Request filter controls">
        <SearchInput
          value={filter}
          onValueChange={setFilter}
          placeholder="Filter requests…"
          className="w-full"
        />
      </WorkbenchToolbar>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        {/* Two owners would settle each other's rows, so the action and the list are two
            subjects — which is also what they are to a person. */}
        <ApiProblem subject="Request action" message={actionError} />
        <ApiProblem subject="Saved requests" message={error} centered />
        {loading ? (
          <LoadingHint className="p-3">Loading saved requests…</LoadingHint>
        ) : error ? null : requests.length === 0 && folders.length === 0 ? (
          <StateNotice
            title="No saved requests"
            actions={
              <Button variant="ghost" size="sm" disabled={creating} onClick={() => createNew()}>
                <Plus className="size-3.5" />
                New request
              </Button>
            }
          />
        ) : shown.length === 0 && filter.trim() !== '' ? (
          <EmptyHint className="p-4">No request matches “{filter}”.</EmptyHint>
        ) : (
          <>
            {group === 'folder' ? (
              // The storage is hierarchical — a request called `users/list` IS in a folder — so
              // this is the view that matches what is on disk, and it is the default.
              <RequestTree
                requests={shown}
                folders={filter.trim() === '' ? folders : []}
                renderRow={renderRow}
                // A move IS a rename: the folder is part of the name (see model/moveRequest.ts),
                // so this is the same route the rename box uses, and it reports a clash the same way.
                onMove={(from, to) =>
                  manage(from, () =>
                    restApi.rename(sessionId, from, to).then((moved) => {
                      if (activeName === from) onSelect(moved.name)
                    }),
                  )
                }
                onCreate={(folder) => createNew(folder)}
                onCreateFolder={(parent) => {
                  setFolderParent(parent)
                  setFolderName('')
                }}
                onDeleteFolder={removeFolder}
              />
            ) : groups ? (
              <div className="pb-1">
                {groups.map(([key, items]) => (
                  <CollapsibleSection key={key} title={key} count={items.length} defaultOpen>
                    <div role="list" aria-label={`${key} requests`}>
                      {items.map((request) => renderRow(request))}
                    </div>
                  </CollapsibleSection>
                ))}
              </div>
            ) : (
              <div role="list" aria-label="Saved requests">
                {shown.map((request) => renderRow(request))}
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete saved request?"
        description={
          confirmDelete
            ? `“${confirmDelete}” will be removed. This does not delete any secret it references.`
            : ''
        }
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
      />

      <NewFolderDialog
        folderParent={folderParent}
        setFolderParent={setFolderParent}
        folderName={folderName}
        setFolderName={setFolderName}
        creating={creating}
        createFolder={createFolder}
      />

      <ImportDialog
        sessionId={sessionId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={async (res) => {
          await Promise.all([refresh(), refreshEnvironments()])
          const first = res.requests[0]
          if (first) onSelect(first.name)
        }}
      />
    </div>
  )
}
