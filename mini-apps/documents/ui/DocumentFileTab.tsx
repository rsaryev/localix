import { useCallback, useEffect, useRef, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { resourceMessageBindingDraft, type PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { localixResourceUri } from '@localixai/mini-app-sdk/navigation'
import type { ExtractedDocument } from './docClient'
import { documentsApi } from './api/documentsApi'
import { MarkdownRenderer } from '@localixai/kit/markdown'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import { documentFailure } from './failure'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { TableGrid } from '@localixai/mini-app-sdk/ui/components'
import { useDocumentProblem } from './problems'

interface DocumentFileTabProps {
  path: string
  /** Present for prop symmetry with the other file tabs; extraction reads the path
   *  directly, so it isn't required here. */
  sessionId?: string | null
  /** A stored (dropped/uploaded) document extracted by content id — web open path. */
  mediaId?: string
  /** Original filename, for the header/title when opened by mediaId (path is empty). */
  name?: string
  publishMessageContext?: PublishMessageContext
}

type DocLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; detail?: string }
  | { status: 'ready'; id: string; doc: ExtractedDocument }

/**
 * Read-only viewer for office documents (docx / odt / pptx). Runs the file through
 * the document-extraction service and renders the result: text/slides as Markdown
 * (via MarkdownRenderer), a table extraction as the dataview grid. Extraction is
 * cached content-addressed server-side, so re-opening is cheap. v1 is read-only.
 */
export function DocumentFileTab({
  path,
  mediaId,
  name,
  publishMessageContext,
}: DocumentFileTabProps) {
  const workItemVisible = useWorkItemVisible()
  const label = name ?? baseName(path)
  const [state, setState] = useState<DocLoadState>({ status: 'loading' })
  const [reloadNonce, setReloadNonce] = useState(0)
  const loaded = useRef(false)

  // Mounted with a stable key by the registry, so 'loading' is the correct initial
  // state; Retry resets it explicitly — no synchronous setState inside the effect.
  const retry = useCallback(() => {
    loaded.current = false
    setState({ status: 'loading' })
    setReloadNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!workItemVisible || loaded.current) return
    let cancelled = false
    // Extract from a stored content id (dropped/uploaded file) or an absolute path.
    documentsApi
      .extract(mediaId ? { mediaId } : { path })
      .then((res) => {
        if (!cancelled) {
          loaded.current = true
          setState({ status: 'ready', id: res.id, doc: res.document })
        }
      })
      .catch((err) => {
        if (!cancelled)
          setState({
            status: 'error',
            ...documentFailure(err, 'This document could not be opened.'),
          })
      })
    return () => {
      cancelled = true
    }
  }, [path, mediaId, reloadNonce, workItemVisible])

  // A binary Office file cannot be expanded through the generic `@file:` path
  // reader. Replace it with the documents mini app's extracted, bounded `localix://resource/doc`
  // resource as soon as the viewer has the content-addressed cache id.
  useEffect(() => {
    if (!publishMessageContext) return
    if (state.status !== 'ready') {
      publishMessageContext(null)
      return
    }
    publishMessageContext({
      strategy: 'replace',
      bindings: [
        resourceMessageBindingDraft({
          uri: localixResourceUri('doc', [state.id]),
          label,
        }),
      ],
    })
  }, [label, publishMessageContext, state])

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

  const { doc } = state
  const truncated = Boolean(doc.metadata.truncated)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {truncated && (
        <WorkbenchNoticeBar
          role="status"
          tone="warning"
          icon={<TriangleAlert className="size-3.5" />}
          title="This document is large — only the first part is shown."
        />
      )}
      {doc.kind === 'table' ? (
        <TableGrid
          columns={doc.columns}
          rows={doc.rows}
          total={doc.rows.length}
          onToggleSort={() => {}}
          onReachEnd={() => {}}
          showColumnTypes
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto px-6 py-4 text-sm text-foreground scrollbar-thin">
          <MarkdownRenderer>{doc.markdown}</MarkdownRenderer>
        </div>
      )}
    </div>
  )
}
