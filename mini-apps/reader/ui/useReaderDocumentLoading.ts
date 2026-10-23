import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import { loadJSON } from '@localixai/mini-app-sdk/ui/storage'

import type { ReaderChapter, ReaderDocument, ReaderSource } from '../shared/contracts'
import { readerUnsupportedReason } from '../shared/formats'
import { readerApi } from './api'
import { highlightReaderCode } from './code-highlighting'
import type { ReaderProgress } from './model'
import { progressKey } from './readerStorage'
import { readerFailureDetail } from './readerSources'
import { readerChapterEntryFraction, readerRestoredChapter } from './readerPosition'
import type { ReaderPosition } from './useReaderPosition'

/**
 * The open book and its current chapter. Held apart from the loading effects because text
 * selection keys on the chapter while chapter loading clears the selection.
 */
export function useReaderDocumentState(initialChapter: number | undefined) {
  const [document, setDocument] = useState<ReaderDocument | null>(null)
  const [chapter, setChapter] = useState<ReaderChapter | null>(null)
  const [chapterIndex, setChapterIndex] = useState(initialChapter ?? 0)
  const [loadedChapterIndex, setLoadedChapterIndex] = useState(initialChapter ?? 0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** What the parser itself said, when it was not us. Event Center only, never on the pane. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  /** Bumped by "Try again" — a transient failure (a file still being written, a
   *  backend hiccup) must be recoverable without closing the tab. */
  const [reloadToken, setReloadToken] = useState(0)
  return {
    document,
    setDocument,
    chapter,
    setChapter,
    chapterIndex,
    setChapterIndex,
    loadedChapterIndex,
    setLoadedChapterIndex,
    loading,
    setLoading,
    error,
    setError,
    errorDetail,
    setErrorDetail,
    reloadToken,
    setReloadToken,
  }
}

export type ReaderDocumentState = ReturnType<typeof useReaderDocumentState>

/** Loads the document, then each chapter it lands on, and restores the stored position. */
export function useReaderDocumentLoading({
  state,
  source,
  sourceKey,
  initialChapter,
  onUnreadable,
  clearSelection,
  setVisiblePassage,
  position,
  articleRef,
}: {
  state: ReaderDocumentState
  source: ReaderSource
  sourceKey: string
  initialChapter: number | undefined
  onUnreadable: ((source: ReaderSource) => void) | undefined
  clearSelection: () => void
  setVisiblePassage: Dispatch<SetStateAction<string>>
  position: Pick<
    ReaderPosition,
    'setScrollFraction' | 'pendingChapterFractionRef' | 'modeSwitchFractionRef'
  >
  articleRef: RefObject<HTMLElement | null>
}) {
  const {
    document,
    setDocument,
    chapter,
    setChapter,
    chapterIndex,
    setChapterIndex,
    setLoadedChapterIndex,
    setLoading,
    setError,
    setErrorDetail,
    reloadToken,
  } = state
  const { setScrollFraction, pendingChapterFractionRef, modeSwitchFractionRef } = position

  useEffect(() => {
    let cancelled = false
    // Judge the source before spending a round-trip on it: an image or any other
    // non-reading format is refused here, with the same wording the backend uses.
    const unsupported = readerUnsupportedReason(source)
    if (unsupported) {
      setDocument(null)
      setChapter(null)
      setError(unsupported)
      setLoading(false)
      onUnreadable?.(source)
      return
    }
    setLoading(true)
    void readerApi
      .document(source)
      .then(({ document: next }) => {
        if (cancelled) return
        setDocument(next)
        const stored = loadJSON<ReaderProgress>(progressKey(sourceKey))
        setChapterIndex(readerRestoredChapter(next.chapters.length, initialChapter, stored))
        setError(null)
        setErrorDetail(null)
      })
      .catch((cause) => {
        if (cancelled) return
        acknowledgeInline(cause)
        setError(cause instanceof Error ? cause.message : 'This file could not be opened.')
        setErrorDetail(readerFailureDetail(cause))
        onUnreadable?.(source)
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [
    initialChapter,
    onUnreadable,
    reloadToken,
    setChapter,
    setChapterIndex,
    setDocument,
    setError,
    setErrorDetail,
    setLoading,
    source,
    sourceKey,
  ])

  useEffect(() => {
    if (!document) return
    let cancelled = false
    setLoading(true)
    clearSelection()
    setVisiblePassage('')
    setScrollFraction(0)
    void readerApi
      .chapter(source, chapterIndex)
      .then(({ chapter: next }) => {
        if (cancelled) return
        setLoadedChapterIndex(chapterIndex)
        setChapter(next)
        setError(null)
        setErrorDetail(null)
        const stored = loadJSON<ReaderProgress>(progressKey(sourceKey))
        const pending = pendingChapterFractionRef.current
        pendingChapterFractionRef.current = null
        const fraction = readerChapterEntryFraction(chapterIndex, pending, stored)
        modeSwitchFractionRef.current = fraction
        setScrollFraction(fraction)
      })
      .catch((cause) => {
        if (cancelled) return
        acknowledgeInline(cause)
        setError(cause instanceof Error ? cause.message : 'This chapter could not be opened.')
        setErrorDetail(readerFailureDetail(cause))
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [
    chapterIndex,
    clearSelection,
    document,
    modeSwitchFractionRef,
    pendingChapterFractionRef,
    setChapter,
    setError,
    setErrorDetail,
    setLoadedChapterIndex,
    setLoading,
    setScrollFraction,
    setVisiblePassage,
    source,
    sourceKey,
  ])

  useEffect(() => {
    if (chapter?.kind !== 'html' || !articleRef.current) return
    const frame = requestAnimationFrame(() => {
      if (articleRef.current) highlightReaderCode(articleRef.current)
    })
    return () => cancelAnimationFrame(frame)
  }, [articleRef, chapter])
}
