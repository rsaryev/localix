/**
 * The API workspace's NAVIGATOR: the saved requests, filterable, sortable, groupable.
 *
 * It selects, it does not navigate. Choosing a row moves the workspace's request/response panes
 * onto it so the list and edited request stay visible together. Opening a request in its own grid
 * tab remains an explicit row action, matching the database plugin's SQL-console behavior.
 *
 * "+" mints a request (or imports one from pasted cURL) and selects it; row actions duplicate,
 * rename, or delete. Sort and group choices persist per browser. The state ladder is loading →
 * error → empty → content.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownUp, FilePlus2, FileUp, FolderPlus, Plus } from 'lucide-react'
import { acknowledgeInline } from '@localixai/plugin-sdk/ui'
import { PanelHeader } from '@localixai/kit/panel-header'
import { StateNotice } from '@localixai/kit/state-notice'
import { ApiProblem, useApiProblem } from './problems'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { Button } from '@localixai/kit/button'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { RefreshAction } from '@localixai/kit/refresh-action'
import { SearchInput } from '@localixai/kit/search-input'
import { Textarea } from '@localixai/kit/textarea'
import { Input } from '@localixai/kit/input'
import { CollapsibleSection } from '@localixai/kit/collapsible-section'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import { loadJSON, saveJSON } from '@localixai/plugin-sdk/ui/storage'
import type { ImportResponse, RequestInfo } from '../backend/contracts'
import type { useEnvironments } from './model/useEnvironments'
import { useRequests, type RequestsState } from './model/useRequests'
import { EnvironmentPicker } from './ui/EnvironmentPicker'
import { openRestRequestTab } from './model/openTab'
import { groupKey, sortRequests, type GroupMode, type SortMode } from './model/sortRequests'
import { restApi } from './restApi'
import { RequestRow } from './ui/RequestRow'
import { RequestTree } from './ui/RequestTree'
import { importMessageForUi } from './model/importPresentation'

function filterRequests(requests: RequestInfo[], filter: string): RequestInfo[] {
  const needle = filter.trim().toLowerCase()
  if (needle === '') return requests
  return requests.filter(
    (r) =>
      r.name.toLowerCase().includes(needle) ||
      r.spec.url.toLowerCase().includes(needle) ||
      r.spec.method.toLowerCase().includes(needle),
  )
}

const SORT_MODES: readonly SortMode[] = ['name', 'method', 'recent']
const GROUP_MODES: readonly GroupMode[] = ['folder', 'none', 'host', 'method']
const SORT_LABELS: Record<SortMode, string> = { name: 'Name', method: 'Method', recent: 'Recent' }
const GROUP_LABELS: Record<GroupMode, string> = {
  folder: 'Folders',
  none: 'None',
  host: 'Host',
  method: 'Method',
}

/**
 * Sort and group as two `▸` rows, each naming its current pick.
 *
 * Two stacked radio groups put seven rows on screen to answer two questions, and the answers sat
 * as unlabelled dots inside them. A submenu per dimension shows both answers at a glance (`hint`),
 * and `keepOpen` steps a choice back to this level so the person sees the answer move.
 */
function sortGroupEntries(
  sort: SortMode,
  setSort: (v: SortMode) => void,
  group: GroupMode,
  setGroup: (v: GroupMode) => void,
): MenuEntry[] {
  return [
    {
      id: 'sort',
      label: 'Sort by',
      hint: SORT_LABELS[sort],
      items: SORT_MODES.map((m) => ({
        id: `sort:${m}`,
        label: SORT_LABELS[m],
        selected: m === sort,
        keepOpen: true,
        onSelect: () => setSort(m),
      })),
    },
    {
      id: 'group',
      label: 'Group by',
      hint: GROUP_LABELS[group],
      items: GROUP_MODES.map((m) => ({
        id: `group:${m}`,
        label: GROUP_LABELS[m],
        selected: m === group,
        keepOpen: true,
        onSelect: () => setGroup(m),
      })),
    },
  ]
}

function persisted<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = loadJSON<T>(key)
  return v && allowed.includes(v) ? v : fallback
}

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
  const { environments, active, use, refresh: refreshEnvironments } = environmentState
  const [filter, setFilter] = useState('')
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  // A failed create/manage action is shown once above the list, replaced by the next action.
  const [actionError, setActionError] = useState<string | null>(null)
  const [folderParent, setFolderParent] = useState<string | null>(null)
  const [folderName, setFolderName] = useState('')

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

  // Mint a blank request under the first free `new-request[-N]` name and select it immediately;
  // naming and other edits happen in the request pane rather than an extra form.
  const createNew = (folder = '') => {
    if (creating) return
    setCreating(true)
    setActionError(null)
    const taken = new Set(requests.map((r) => r.name))
    const prefix = folder === '' ? '' : `${folder}/`
    let name = `${prefix}new-request`
    for (let n = 2; taken.has(name); n++) name = `${prefix}new-request-${n}`
    void restApi
      .create(sessionId, { name, method: 'GET', url: '' })
      .then((res) => {
        onSelect(res.request.name)
        return refresh()
      })
      .catch((err: unknown) => {
        acknowledgeInline(err)
        setActionError(err instanceof Error ? err.message : 'Could not create the request.')
      })
      .finally(() => {
        setCreating(false)
      })
  }

  const createFolder = () => {
    if (folderParent === null || creating) return
    const leaf = folderName.trim().replace(/^\/+|\/+$/g, '')
    if (!leaf) return
    const name = folderParent ? `${folderParent}/${leaf}` : leaf
    setCreating(true)
    setActionError(null)
    void restApi
      .createFolder(sessionId, name)
      .then(async () => {
        setGroup('folder')
        await refresh()
        setFolderParent(null)
        setFolderName('')
      })
      .catch((err: unknown) => {
        acknowledgeInline(err)
        setActionError(err instanceof Error ? err.message : 'Could not create the folder.')
      })
      .finally(() => setCreating(false))
  }

  const removeFolder = (name: string) => {
    setActionError(null)
    void restApi
      .removeFolder(sessionId, name)
      .then(() => refresh())
      .catch((err: unknown) => {
        acknowledgeInline(err)
        setActionError(err instanceof Error ? err.message : 'Could not delete the folder.')
      })
  }

  const remove = async (name: string) => {
    setPending((p) => ({ ...p, [name]: true }))
    setActionError(null)
    try {
      await restApi.remove(sessionId, name)
      if (name === activeName) onSelect(undefined)
      await refresh()
    } catch (err) {
      acknowledgeInline(err)
      setActionError(err instanceof Error ? err.message : 'Could not delete the request.')
    } finally {
      setPending((p) => ({ ...p, [name]: false }))
      setConfirmDelete(null)
    }
  }

  // A failed manage action (rename to a taken name, duplicate of a just-deleted row) is shown
  // once above the list, replaced by the next action — not trapped in a dialog.
  const manage = (name: string, action: () => Promise<unknown>) => {
    setPending((p) => ({ ...p, [name]: true }))
    setActionError(null)
    void action()
      .then(() => refresh())
      .catch((err: unknown) => {
        acknowledgeInline(err)
        setActionError(err instanceof Error ? err.message : 'The action failed.')
      })
      .finally(() => {
        setPending((p) => ({ ...p, [name]: false }))
      })
  }

  // Import is a deliberate preview → save flow. A browser HAR can contain hundreds of requests,
  // and a Postman environment contains none, so neither "save immediately" nor "first request or
  // failure" is a truthful UI model.
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importBaseUrl, setImportBaseUrl] = useState('')
  const [importPreview, setImportPreview] = useState<ImportResponse | null>(null)
  const [importResult, setImportResult] = useState<ImportResponse | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<{ message: string; detail?: string } | null>(null)
  const importFile = useRef<HTMLInputElement>(null)
  const closeImport = () => {
    setImportOpen(false)
    setImportText('')
    setImportBaseUrl('')
    setImportPreview(null)
    setImportResult(null)
    setImportError(null)
  }
  const changeImportSource = (source: string) => {
    setImportText(source)
    setImportPreview(null)
    setImportResult(null)
    setImportError(null)
  }
  const runImport = (save: boolean) => {
    const source = importText.trim()
    if (source === '' || importing) return
    setImporting(true)
    setImportError(null)
    void restApi
      .importSource(sessionId, {
        source,
        save,
        ...(importBaseUrl.trim() ? { baseUrl: importBaseUrl.trim() } : {}),
      })
      .then(async (res) => {
        if (save) {
          await Promise.all([refresh(), refreshEnvironments()])
          const first = res.requests[0]
          if (first) onSelect(first.name)
          setImportResult(res)
        } else {
          setImportPreview(res)
        }
      })
      .catch((err: unknown) => {
        acknowledgeInline(err)
        // The importer's diagnostic is a multi-paragraph report about somebody's OpenAPI file. It
        // is the most useful thing here and the worst possible headline, so the sentence goes on
        // the line and the report goes where there is room for it.
        const detail =
          err instanceof Error && 'detail' in err && typeof err.detail === 'string'
            ? importMessageForUi(err.detail)
            : ''
        setImportError({
          message: err instanceof Error ? err.message : 'Import failed.',
          ...(detail ? { detail } : {}),
        })
      })
      .finally(() => {
        setImporting(false)
      })
  }

  // Owned by the sidebar, drawn in the dialog: the dialog unmounts on close, and an owner that
  // unmounts never settles the row it published.
  const importProblem = useApiProblem({
    subject: 'Import',
    message: importError?.message,
    detail: importError?.detail,
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
          <>
            <EnvironmentPicker
              environments={environments}
              active={active}
              onUse={(name) => void use(name)}
              onManage={onManageEnvironments}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" aria-label="New request">
                  <Plus className="size-3.5" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => createNew()}>
                  <FilePlus2 className="size-3.5" />
                  New request
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setFolderParent('')}>
                  <FolderPlus className="size-3.5" />
                  New folder…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setImportOpen(true)}>Import…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="sm" aria-label="Sort and group">
                  <ArrowDownUp className="size-3.5" />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-40">
                <MenuEntries
                  entries={sortGroupEntries(sort, setSort, group, setGroup)}
                  family="dropdown"
                />
              </DropdownMenuContent>
            </DropdownMenu>

            <RefreshAction
              size="sm"
              aria-label="Refresh"
              tooltip="Refresh"
              onClick={() => void refresh()}
            />
          </>
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
              <Button variant="outline" size="sm" disabled={creating} onClick={() => createNew()}>
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

      <Dialog
        open={folderParent !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFolderParent(null)
            setFolderName('')
          }
        }}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>New folder</DialogTitle>
            <DialogDescription>
              {folderParent ? `Inside “${folderParent}”.` : 'Create a folder in this collection.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Input
              autoFocus
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && folderName.trim()) createFolder()
              }}
              placeholder="users"
              aria-label="Folder name"
            />
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderParent(null)}>
              Cancel
            </Button>
            <Button disabled={creating || !folderName.trim()} onClick={createFolder}>
              Create folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => (open ? setImportOpen(true) : closeImport())}
      >
        <DialogContent size="2xl">
          <DialogHeader>
            <DialogTitle>Import</DialogTitle>
            <DialogDescription>
              cURL, OpenAPI, Postman, Insomnia, HAR, or a Localix request file.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            {!importResult && (
              <>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => importFile.current?.click()}>
                    <FileUp className="size-3.5" />
                    Choose file
                  </Button>
                  <span className="text-2xs text-text-faint">or paste the source below</span>
                  <input
                    ref={importFile}
                    type="file"
                    className="hidden"
                    accept=".json,.yaml,.yml,.har,.txt"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (!file) return
                      void file.text().then(changeImportSource)
                      event.target.value = ''
                    }}
                  />
                </div>
                <Textarea
                  autoFocus
                  value={importText}
                  onChange={(e) => changeImportSource(e.target.value)}
                  placeholder="curl https://api.example.com/users"
                  aria-label="Import source"
                  className="min-h-36 font-mono"
                />
                <label className="grid gap-1">
                  <span className="text-2xs font-medium text-text-soft">Base URL (optional)</span>
                  <Input
                    value={importBaseUrl}
                    onChange={(event) => {
                      setImportBaseUrl(event.target.value)
                      setImportPreview(null)
                    }}
                    placeholder="https://api.example.com"
                    className="font-mono text-xs"
                  />
                </label>
              </>
            )}
            {(importResult ?? importPreview) && (
              <pre className="scrollbar-thin max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-border-soft bg-surface-sunken p-3 font-mono text-2xs text-text-soft">
                {importMessageForUi((importResult ?? importPreview)?.message ?? '')}
              </pre>
            )}
            {importProblem}
          </DialogBody>
          <DialogFooter>
            {importResult ? (
              <Button variant="mono" onClick={closeImport}>
                Done
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={closeImport}>
                  Cancel
                </Button>
                {importPreview ? (
                  <Button variant="mono" disabled={importing} onClick={() => runImport(true)}>
                    {importing ? 'Importing…' : 'Import'}
                  </Button>
                ) : (
                  <Button
                    variant="mono"
                    disabled={importing || importText.trim() === ''}
                    onClick={() => runImport(false)}
                  >
                    {importing ? 'Reading…' : 'Preview'}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
