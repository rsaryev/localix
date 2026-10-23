import { useCallback, useEffect, useRef, useState } from 'react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { tableApi } from './api/tableApi'
import { documentsApi } from './api/documentsApi'
import type { TableMeta } from './docClient'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import { documentFailure } from './failure'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { TableTab } from './table/TableTab'
import { useDocumentProblem } from './problems'
import { usePublishDocContext } from './usePublishDocContext'

interface TableFileTabProps {
  path: string
  /** The session this tab belongs to (its grid scope) — every file tab is opened into one. */
  sessionId: string
  /** WorkItem title, used for the table tab heading. */
  title?: string
  /** A stored (dropped/uploaded) spreadsheet ingested by content id — web open path. */
  mediaId?: string
  /** Original filename, for the title when opened by mediaId (path is empty). */
  name?: string
  publishMessageContext?: PublishMessageContext
}

type IngestState =
  | { status: 'loading' }
  | { status: 'error'; message: string; detail?: string }
  | { status: 'ready'; meta: TableMeta }

/**
 * Opens a spreadsheet file (csv/xlsx) as a native Table. On mount it asks the server
 * to ingest the file into the Table pipeline (extract → persist), then renders the
 * full-featured Table tab by id — lazy server-paged rows, sort/filter, chart views,
 * CSV/XLSX export, drag-to-chat. Read-only in v1 (the source file isn't written back).
 */
export function TableFileTab({
  path,
  sessionId,
  title,
  mediaId,
  name,
  publishMessageContext,
}: TableFileTabProps) {
  const workItemVisible = useWorkItemVisible()
  const label = name ?? baseName(path)
  const [state, setState] = useState<IngestState>({ status: 'loading' })
  const [contextId, setContextId] = useState<string>()
  const [reloadNonce, setReloadNonce] = useState(0)
  const ingested = useRef(false)

  // Mounted with a stable key by the registry, so 'loading' is the correct initial
  // state; Retry resets it explicitly — no synchronous setState inside the effect.
  const retry = useCallback(() => {
    ingested.current = false
    setContextId(undefined)
    setState({ status: 'loading' })
    setReloadNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!workItemVisible || ingested.current) return
    let cancelled = false
    // Ingest from a stored content id (dropped/uploaded file) or an absolute path.
    void (
      mediaId ? tableApi.ingestMedia(sessionId, mediaId, name) : tableApi.ingest(sessionId, path)
    )
      .then((meta) => {
        if (!cancelled) {
          ingested.current = true
          setState({ status: 'ready', meta })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setState({
            status: 'error',
            ...documentFailure(err, 'This file could not be read as a table.'),
          })
        }
      })
    // Table ingestion and `localix://resource/doc` extraction share the same content-addressed
    // document service. Ask for its stable resource id in parallel; this is a
    // cache hit after whichever request wins and does not copy rows into UI state.
    void documentsApi
      .extract(mediaId ? { mediaId } : { path })
      .then((res) => {
        if (!cancelled) setContextId(res.id)
      })
      .catch(() => {
        // Keep the table usable; absence of an id means no model context is claimed.
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, path, mediaId, name, reloadNonce, workItemVisible])

  usePublishDocContext(publishMessageContext, contextId, label)

  const problem = useDocumentProblem({
    label,
    path,
    message: state.status === 'error' ? state.message : null,
    detail: state.status === 'error' ? state.detail : null,
    onRetry: retry,
  })

  if (state.status === 'loading') {
    return <LoadingHint className="min-h-0 flex-1 text-xs">Opening {label}…</LoadingHint>
  }
  if (state.status === 'error') return problem
  return <TableTab tableId={state.meta.id} title={title ?? state.meta.title ?? label} />
}
