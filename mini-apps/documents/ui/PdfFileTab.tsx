import { useCallback, useEffect, useState } from 'react'
import { FileWarning } from 'lucide-react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import { miniAppApiUrl } from '@localixai/mini-app-sdk/ui/transport'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { baseName } from '@localixai/mini-app-sdk/ui/utilities'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { PDF_CONTENT_TYPE } from '@localixai/mini-app-sdk/ui/file-types'
import { documentsApi } from './api/documentsApi'
import { documentFailure } from './failure'
import { useDocumentProblem } from './problems'
import { usePublishDocContext } from './usePublishDocContext'

interface PdfFileTabProps {
  path: string
  /** The session this tab belongs to (its grid scope) — every file tab is opened into one. */
  sessionId: string
  /** A stored (dropped/uploaded) PDF served by content id — path-free web open path. */
  mediaId?: string
  /** Original filename, for the header/title when opened by mediaId (path is empty). */
  name?: string
  publishMessageContext?: PublishMessageContext
}

type PdfLoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string; detail?: string }
  | { status: 'too-large' }
  | { status: 'ready'; url: string }

/** Decode base64 file bytes into a typed Blob for an object URL. */
function base64ToBlob(b64: string, mimeType: string): Blob {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mimeType })
}

/**
 * Read-only PDF viewer for the inspector. The backend serves office/PDF files as
 * base64 (`file-ops` `BINARY_DOC_MIME`, up to 30 MB); we wrap those bytes in a Blob
 * object URL and hand it to the browser's native PDF viewer (PDFium under Chromium /
 * WKWebView) via an <iframe>. No editing — a PDF is a rendered artifact.
 */
export function PdfFileTab({
  path,
  sessionId,
  mediaId,
  name,
  publishMessageContext,
}: PdfFileTabProps) {
  const workItemVisible = useWorkItemVisible()
  const label = name ?? baseName(path)
  const [state, setState] = useState<PdfLoadState>({ status: 'loading' })
  const [contextId, setContextId] = useState<string>()
  const [reloadNonce, setReloadNonce] = useState(0)
  const mediaUrl = mediaId ? miniAppApiUrl(`/rpc/media/${encodeURIComponent(mediaId)}`) : null

  // Mounted with a stable key by the registry, so 'loading' is the correct initial
  // state; Retry resets it explicitly (below) — no synchronous setState in the effect.
  const retry = useCallback(() => {
    setContextId(undefined)
    setState({ status: 'loading' })
    setReloadNonce((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!workItemVisible) return
    if (mediaId) return // media-backed path handled above
    let cancelled = false
    let objectUrl: string | null = null
    miniAppFiles
      .read(sessionId, path, { full: true })
      .then((res) => {
        if (cancelled) return
        // The reader caps binary docs at 30 MB and returns `truncated` with empty
        // content past that — there are no partial-PDF bytes to render.
        if (res.truncated || !res.content) {
          setState({ status: 'too-large' })
          return
        }
        objectUrl = URL.createObjectURL(base64ToBlob(res.content, res.mimeType ?? PDF_CONTENT_TYPE))
        setState({ status: 'ready', url: objectUrl })
      })
      .catch((err) => {
        if (!cancelled)
          setState({ status: 'error', ...documentFailure(err, 'This PDF could not be opened.') })
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sessionId, path, reloadNonce, mediaId, workItemVisible])

  // Native PDF rendering and model-readable extraction are separate concerns.
  // The extractor is content-addressed/cached and yields the provider-owned
  // `localix://resource/doc` identity; the raw PDF bytes never enter the composer binding.
  useEffect(() => {
    if (!workItemVisible || contextId) return
    let cancelled = false
    documentsApi
      .extract(mediaId ? { mediaId } : { path })
      .then((res) => {
        if (!cancelled) setContextId(res.id)
      })
      .catch(() => {
        // Preview can still be useful when text extraction is unavailable. In
        // that case no false model-readable binding is published.
      })
    return () => {
      cancelled = true
    }
  }, [contextId, mediaId, path, reloadNonce, workItemVisible])

  usePublishDocContext(publishMessageContext, contextId, label)

  const problem = useDocumentProblem({
    label,
    path,
    message: !mediaUrl && state.status === 'error' ? state.message : null,
    detail: !mediaUrl && state.status === 'error' ? state.detail : null,
    onRetry: retry,
  })

  const resolvedState: PdfLoadState = mediaUrl ? { status: 'ready', url: mediaUrl } : state
  if (resolvedState.status === 'loading') {
    return <LoadingHint className="min-h-0 flex-1 text-xs">Loading {label}…</LoadingHint>
  }
  if (resolvedState.status === 'error') return problem
  if (resolvedState.status === 'too-large') {
    return (
      <StateNotice
        icon={FileWarning}
        title={label}
        body="PDF is too large to preview in-app (over 30 MB). Open it in a native reader instead."
      />
    )
  }
  return (
    <div className="min-h-0 flex-1">
      <iframe src={resolvedState.url} title={label} className="h-full w-full border-0" />
    </div>
  )
}
