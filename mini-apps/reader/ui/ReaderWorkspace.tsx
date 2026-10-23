import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PublishedMessageContext, PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { loadJSON, saveJSON } from '@localixai/mini-app-sdk/ui/storage'

import type { ReaderSource } from '../shared/contracts'
import { mergeReaderPublishedContexts, type ReaderPaneId } from './context'
import {
  normalizeReaderWorkspaceSource,
  readerWorkspaceSelectionKey,
  type ReaderTextTarget,
} from './model'
import { LibraryPane } from './ReaderLibraryPane'
import { ReaderPane } from './ReaderReadingPane'
import './reader.css'

interface ReaderLocation {
  source: ReaderSource
  chapter?: number
  highlight?: ReaderTextTarget
}

export function ReaderWorkspace({
  sessionId,
  visible = true,
  initialPath,
  initialMediaId,
  initialName,
  initialChapter,
  publishMessageContext,
}: {
  sessionId: string
  visible?: boolean
  initialPath?: string
  initialMediaId?: string
  initialName?: string
  initialChapter?: number
  publishMessageContext?: PublishMessageContext
}) {
  const persistedSelectionKey =
    initialPath || initialMediaId ? null : readerWorkspaceSelectionKey(sessionId)
  const requestedSelection = useMemo<ReaderLocation | null>(
    () =>
      initialPath
        ? { source: { path: initialPath }, chapter: initialChapter }
        : initialMediaId
          ? {
              source: {
                mediaId: initialMediaId,
                ...(initialName ? { name: initialName } : {}),
              },
              chapter: initialChapter,
            }
          : null,
    [initialChapter, initialMediaId, initialName, initialPath],
  )
  const [selection, setSelection] = useState<ReaderLocation | null>(
    () =>
      requestedSelection ??
      (persistedSelectionKey
        ? (() => {
            const source = normalizeReaderWorkspaceSource(loadJSON<unknown>(persistedSelectionKey))
            return source ? { source } : null
          })()
        : null),
  )
  const [parallelSelection, setParallelSelection] = useState<ReaderLocation | null>(null)
  const [activePane, setActivePane] = useState<ReaderPaneId>('primary')
  const [primaryContext, setPrimaryContext] = useState<PublishedMessageContext | null>(null)
  const [secondaryContext, setSecondaryContext] = useState<PublishedMessageContext | null>(null)
  const primaryChapterRef = useRef(initialChapter ?? 0)
  const requestedSelectionSignature = initialPath
    ? `path:${initialPath}:${initialChapter ?? ''}`
    : initialMediaId
      ? `media:${initialMediaId}:${initialName ?? ''}:${initialChapter ?? ''}`
      : 'library'
  const previousRequestedSelectionSignatureRef = useRef(requestedSelectionSignature)
  useEffect(() => {
    if (previousRequestedSelectionSignatureRef.current === requestedSelectionSignature) return
    previousRequestedSelectionSignatureRef.current = requestedSelectionSignature
    setSelection(requestedSelection)
    setParallelSelection(null)
    primaryChapterRef.current = initialChapter ?? 0
  }, [initialChapter, requestedSelection, requestedSelectionSignature])

  useEffect(() => {
    if (!persistedSelectionKey) return
    saveJSON(persistedSelectionKey, selection?.source)
  }, [persistedSelectionKey, selection?.source])

  const publishPrimary = useCallback<PublishMessageContext>((context) => {
    setPrimaryContext(context)
  }, [])
  const publishSecondary = useCallback<PublishMessageContext>((context) => {
    setSecondaryContext(context)
  }, [])
  const rememberPrimaryChapter = useCallback((chapter: number) => {
    primaryChapterRef.current = chapter
  }, [])

  // A source that failed to open must not be restored on the next visit: it used
  // to be persisted regardless, so reopening Reader landed straight back on the
  // failure. Forget it — the pane keeps showing the failure with its exits until
  // the user leaves.
  const forgetUnreadableSource = useCallback(() => {
    if (persistedSelectionKey) saveJSON(persistedSelectionKey, undefined)
  }, [persistedSelectionKey])

  useEffect(() => {
    if (!parallelSelection || !publishMessageContext) return
    publishMessageContext(
      mergeReaderPublishedContexts(primaryContext, secondaryContext, activePane),
    )
    return () => publishMessageContext(null)
  }, [activePane, parallelSelection, primaryContext, publishMessageContext, secondaryContext])

  if (!selection) {
    return (
      <LibraryPane
        sessionId={sessionId}
        onOpen={(source, chapter, highlight) =>
          setSelection({
            source,
            ...(chapter === undefined ? {} : { chapter }),
            ...(highlight ? { highlight } : {}),
          })
        }
      />
    )
  }
  const { source } = selection
  const parallel = parallelSelection !== null
  return (
    <div className={`reader-parallel-grid h-full min-h-0${parallel ? ' is-parallel' : ''}`}>
      <div className="min-h-0 min-w-0" data-reader-pane="primary">
        <ReaderPane
          sessionId={sessionId}
          path={'path' in source ? source.path : undefined}
          mediaId={'mediaId' in source ? source.mediaId : undefined}
          name={'mediaId' in source ? source.name : undefined}
          initialChapter={selection.chapter}
          initialHighlight={selection.highlight}
          visible={visible}
          compact={parallel}
          keyboardActive={visible && (!parallel || activePane === 'primary')}
          parallelActive={parallel}
          onActivate={() => setActivePane('primary')}
          onChapterChange={rememberPrimaryChapter}
          onParallelRead={() => {
            if (parallelSelection) {
              setParallelSelection(null)
              setSecondaryContext(null)
              setActivePane('primary')
            } else {
              setParallelSelection({
                source,
                chapter: primaryChapterRef.current + 1,
              })
              setActivePane('secondary')
            }
          }}
          // Always an exit. A book opened as its own tab (file association, deep
          // link) used to have none, so a document it could not parse trapped the
          // tab; falling back to the library is the honest way back.
          onBack={() => {
            setSelection(null)
            setParallelSelection(null)
          }}
          onUnreadable={forgetUnreadableSource}
          onOpenBook={(nextSource) => setSelection({ source: nextSource })}
          publishMessageContext={parallel ? publishPrimary : publishMessageContext}
        />
      </div>
      {parallelSelection && (
        <div className="min-h-0 min-w-0" data-reader-pane="secondary">
          <ReaderPane
            sessionId={sessionId}
            path={'path' in parallelSelection.source ? parallelSelection.source.path : undefined}
            mediaId={
              'mediaId' in parallelSelection.source ? parallelSelection.source.mediaId : undefined
            }
            name={'mediaId' in parallelSelection.source ? parallelSelection.source.name : undefined}
            initialChapter={parallelSelection.chapter}
            initialHighlight={parallelSelection.highlight}
            visible={visible}
            compact
            keyboardActive={visible && activePane === 'secondary'}
            onActivate={() => setActivePane('secondary')}
            onClosePane={() => {
              setParallelSelection(null)
              setSecondaryContext(null)
              setActivePane('primary')
            }}
            onOpenBook={(nextSource) => setParallelSelection({ source: nextSource })}
            publishMessageContext={publishSecondary}
          />
        </div>
      )}
    </div>
  )
}
