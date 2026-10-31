import { lazy } from 'react'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import type { WorkItem } from '@/shared/lib/workItem'
import { useFileEditorsFor } from '@/shared/contrib/useFileEditorsFor'
import { loadFileEditor } from '@/features/inspector/model/fileEditorLoader'
import { ContributedFileBody } from './FileEditorPicker'
import { nativeFileViewerKind } from './fileEditorSelection'
import { lazyNamed } from '@/shared/lib/lazyNamed'

const MediaFileTab = lazy(() =>
  import('@/features/inspector/ui/MediaFileTab').then((m) => ({ default: m.MediaFileTab })),
)
// The code editor pulls Monaco — keep it out of the boot chunk; it loads on the first file open.
const FileTab = lazyNamed(() => loadFileEditor(), 'FileTab')

const p = <T,>(item: WorkItem, key: string): T | undefined => item.payload?.[key] as T | undefined

/**
 * A file tab's body: a contributed file-type editor first, else the built-in one. The editors are
 * read through the registry's subscription (`useFileEditorsFor`), so a mini app installed while
 * the file is open (Documents for a CSV) takes the tab over without opening it again.
 */
export function FileWorkItemBody({
  item,
  sessionId,
  publishMessageContext,
}: {
  item: WorkItem
  sessionId: string
  publishMessageContext: PublishMessageContext
}) {
  const filePath = p<string>(item, 'path') ?? ''
  const mediaId = p<string>(item, 'mediaId')
  const mediaName = p<string>(item, 'name')
  // A stored (dropped/uploaded) file has no path — route by its original NAME and
  // hand the viewer the media id; a viewer key stable across path/media opens.
  const viewerKey = mediaId ? (mediaName ?? '') : filePath
  const tabKey = mediaId ?? filePath
  // A contributed file-type editor is consulted FIRST — the open registry outranks the built-in
  // fallbacks below. Media-backed files (dropped/uploaded, no on-disk path) only match
  // contributions that declare `acceptsMedia`; everything else falls through to the generic media
  // viewer.
  const contributedEditors = useFileEditorsFor(viewerKey).filter((e) => !mediaId || e.acceptsMedia)
  const editorPreferenceKey = contributedEditors.find(
    (editor) => editor.preferenceKey,
  )?.preferenceKey
  const nativeViewerKind = nativeFileViewerKind(viewerKey)
  const nativeViewerAvailable = nativeViewerKind !== null
  // The built-in fallback body: a dropped/uploaded file (media id, no on-disk
  // path) shows image / text / binary read-only; a path-backed file opens the
  // plain code editor.
  const renderBuiltin = () =>
    mediaId ? (
      <MediaFileTab key={tabKey} mediaId={mediaId} name={mediaName} />
    ) : (
      <FileTab
        key={filePath}
        itemId={item.id}
        sessionId={sessionId}
        path={filePath}
        line={p<number>(item, 'line')}
        column={p<number>(item, 'column')}
        endLine={p<number>(item, 'endLine')}
        endColumn={p<number>(item, 'endColumn')}
        revealAt={p<number>(item, 'revealAt')}
        publishMessageContext={publishMessageContext}
      />
    )
  if (contributedEditors.length === 0) return renderBuiltin()
  // One match renders directly unless core also has a meaningful native
  // image/text surface; two mini apps show the generic chooser unless exactly one is
  // `preferred` (`initialFileEditorSelection`).
  return (
    <ContributedFileBody
      key={tabKey}
      matches={contributedEditors}
      fileKey={viewerKey}
      preferenceKey={editorPreferenceKey}
      fallbackLabel={
        nativeViewerKind === 'image'
          ? 'Built-in image viewer'
          : mediaId
            ? 'File viewer'
            : 'Code editor'
      }
      offerNativeChoice={nativeViewerAvailable}
      requestedBuiltin={p<string>(item, 'openWith') === 'builtin'}
      renderFallback={renderBuiltin}
      editorProps={{
        itemId: item.id,
        sessionId,
        path: filePath,
        mediaId,
        name: mediaName,
        title: item.title,
        line: p<number>(item, 'line'),
        column: p<number>(item, 'column'),
        endLine: p<number>(item, 'endLine'),
        endColumn: p<number>(item, 'endColumn'),
        revealAt: p<number>(item, 'revealAt'),
        publishMessageContext,
      }}
    />
  )
}
