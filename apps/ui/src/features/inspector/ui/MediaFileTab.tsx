import { useCallback, useEffect, useRef, useState } from 'react'
import { FileX2 } from 'lucide-react'
import { CodeBlock } from '@/shared/ui/code-block/CodeBlock'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { StateNotice } from '@localixai/kit/state-notice'
import { Button } from '@localixai/kit/button'
import { looksBinary } from '@/shared/lib/looksBinary'
import { mediaSrc } from '@/shared/lib/mediaSrc'
import { apiFetch } from '@/shared/api/internal'
import { fileExtension } from '@/shared/lib/contentTypeRouting'
import { FileImageView } from './FileImageView'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import { ProblemLine, useProblemReport } from '@/shared/ui/problem-report'

// Read-only viewer for a file that lives in the media store (a dropped/uploaded
// file with NO on-disk path — only a content id). The editor-grid registry routes
// here for any mediaId-backed `file` WorkItem that isn't a dedicated-viewer format
// (PDF / office / spreadsheet handle their own mediaId). It loads the bytes from
// `GET /rpc/media/:id` and reuses the existing presentational pieces: an image goes
// to FileImageView (zoom/pan), text to the read-only CodeBlock, and a binary blob to
// a download notice — so "drag any file into the app" opens (almost) everything
// instead of falling into the plain path-based editor (which has no path to read).

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'avif',
])

type MediaState =
  | { kind: 'loading' }
  | { kind: 'image'; content: string; mimeType: string; encoding: 'base64' | 'utf8' }
  | { kind: 'text'; content: string; language: string }
  | { kind: 'binary'; size: number }
  /** `message` is the classified sentence; `detail` is what fetch/decode actually said. */
  | { kind: 'error'; message: string; detail?: string }

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000 // avoid a giant apply() argument list on large files
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function MediaFileTab({ mediaId, name }: { mediaId: string; name?: string }) {
  const workItemVisible = useWorkItemVisible()
  const [state, setState] = useState<MediaState>({ kind: 'loading' })
  const [reloadNonce, setReloadNonce] = useState(0)
  const url = mediaSrc({ mediaType: '', mediaId })
  const loadKey = `${url}\x00${name ?? ''}\x00${reloadNonce}`
  const loadedKeyRef = useRef<string | null>(null)

  const retry = useCallback(() => setReloadNonce((n) => n + 1), [])

  useEffect(() => {
    if (!workItemVisible || loadedKeyRef.current === loadKey) return
    let cancelled = false
    const controller = new AbortController()
    // Changing a media id/name must immediately replace an old preview with a
    // loading state; this is intentional synchronization with a new remote file.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ kind: 'loading' })
    void (async () => {
      try {
        const res = await apiFetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`GET ${url} responded ${res.status}`)
        const blob = await res.blob()
        if (cancelled) return
        const ext = fileExtension(name ?? '')
        const type = blob.type || ''
        const isImage = type.startsWith('image/') || IMAGE_EXTENSIONS.has(ext)
        if (isImage) {
          // SVG is text markup — keep it utf8 so FileImageView can show source too.
          if (ext === 'svg' || type === 'image/svg+xml') {
            const text = await blob.text()
            if (!cancelled) {
              loadedKeyRef.current = loadKey
              setState({
                kind: 'image',
                content: text,
                mimeType: 'image/svg+xml',
                encoding: 'utf8',
              })
            }
            return
          }
          const base64 = await blobToBase64(blob)
          if (!cancelled) {
            loadedKeyRef.current = loadKey
            setState({
              kind: 'image',
              content: base64,
              mimeType: type || `image/${ext}`,
              encoding: 'base64',
            })
          }
          return
        }
        const text = await blob.text()
        if (cancelled) return
        loadedKeyRef.current = loadKey
        if (looksBinary(text)) setState({ kind: 'binary', size: blob.size })
        else setState({ kind: 'text', content: text, language: ext || 'text' })
      } catch (e) {
        if (!cancelled && !(e instanceof DOMException && e.name === 'AbortError')) {
          // `HTTP 404` and `TypeError: Failed to fetch` were the whole sentence a person read.
          // Neither says what is wrong with THIS file, and neither survives being skimmed.
          setState({
            kind: 'error',
            message: 'This file could not be loaded from the media store.',
            detail: e instanceof Error ? e.message : String(e),
          })
        }
      }
    })()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [workItemVisible, loadKey, url, name])

  const problem = useProblemReport(
    state.kind === 'error'
      ? {
          // No `path`: a media-store file is addressed by content id, and a bare file NAME in
          // the path slot is not something the centre can open.
          subject: { label: name ?? 'File' },
          problems: [
            {
              message: state.message,
              hint: 'It may have been cleared from the store — try reopening it from its source.',
              detail: state.detail,
            },
          ],
          consequence: 'blocked',
        }
      : null,
    {
      scope: 'editor',
      sourceVisible: workItemVisible,
      actions: [{ id: 'retry', label: 'Retry', run: retry }],
    },
  )

  if (state.kind === 'loading') {
    return <LoadingHint className="min-h-0 flex-1 text-xs">Loading {name ?? 'file'}…</LoadingHint>
  }
  if (state.kind === 'error') {
    return (
      <StateNotice
        icon={FileX2}
        title={name ?? 'File'}
        body={problem && <ProblemLine {...problem} className="items-center" />}
        actionsLabel="Media recovery actions"
        actions={
          <Button type="button" variant="ghost" size="sm" onClick={retry}>
            Retry
          </Button>
        }
      />
    )
  }
  if (state.kind === 'image') {
    return (
      <FileImageView
        path={name ?? ''}
        content={state.content}
        mimeType={state.mimeType}
        encoding={state.encoding}
        truncated={false}
      />
    )
  }
  if (state.kind === 'binary') {
    return (
      <StateNotice
        icon={FileX2}
        title={name ?? 'File'}
        body={`Binary file (${Math.max(1, Math.round(state.size / 1024))} KB) — no text preview.`}
        actionsLabel="Media actions"
        actions={
          <Button asChild variant="ghost" size="sm">
            <a href={url} download={name ?? true}>
              Download
            </a>
          </Button>
        }
      />
    )
  }
  return (
    <div className="h-full overflow-auto scrollbar-thin">
      <CodeBlock code={state.content} language={state.language} bare />
    </div>
  )
}
