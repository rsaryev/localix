import type { ReactNode } from 'react'
import { loadJSON } from '@localixai/mini-app-sdk/ui/storage'

import { ProblemState } from '@localixai/mini-app-sdk/ui/components'

import type { ReaderBookSummary, ReaderSource } from '../shared/contracts'
import { ReaderApiError } from './api'
import { useReaderProblem, type ReaderProblemOptions } from './problems'
import { readerProgressPercent, type ReaderProgress, type ReaderSavedQuote } from './model'
import { progressKey } from './readerStorage'
import './reader.css'

/**
 * Addressing a book, and reporting when addressing it failed.
 *
 * A Reader source is a path or a media id, and half a dozen places had to agree on how to turn a
 * shelf entry into one, how to key it for storage, and how to read its stored progress back. They
 * agree here. Carved out of `ReaderWorkspace.tsx` (4,386 lines).
 */
export function readerFailureDetail(cause: unknown): string | null {
  if (cause instanceof ReaderApiError) return cause.detail ?? null
  return cause instanceof Error ? null : String(cause)
}

/**
 * A reader failure on the pane, and the same failure in the Event Center. One shape for both, so
 * a person who was not looking at the pane still learns what went wrong.
 *
 * A hook, so the panes that branch on `error` can own the report ABOVE the branch: a publisher
 * mounted only inside the failing arm is unmounted the moment the failure ends, which is the one
 * moment the Event Center needs to hear from it. Pass `null` while the pane is healthy.
 */
export function useReaderPaneProblem(
  subject: string,
  message: string | null,
  actions?: ReaderProblemOptions['actions'],
): ReactNode | null {
  const problem = useReaderProblem({ label: subject }, message, { actions })
  if (!problem) return null
  return <ProblemState {...problem} />
}

export function sourceForBook(book: ReaderBookSummary): ReaderSource {
  return book.mediaId ? { mediaId: book.mediaId, name: book.path } : { path: book.path }
}

export function readerBookKey(book: ReaderBookSummary): string {
  return book.mediaId ? `media:${book.mediaId}` : `path:${book.path}`
}

export function sourceFromSaved(item: ReaderSavedQuote): ReaderSource | null {
  if (item.source) return item.source
  if (item.path.startsWith('media:')) return { mediaId: item.path.slice('media:'.length) }
  return item.path ? { path: item.path } : null
}

export function sourceStorageKey(source: ReaderSource): string {
  return 'path' in source ? source.path : `media:${source.mediaId}`
}

export function storedBookProgress(book: ReaderBookSummary): number {
  const progress = loadJSON<ReaderProgress>(progressKey(sourceStorageKey(sourceForBook(book))))
  return progress
    ? readerProgressPercent(
        progress.chapter,
        progress.chapterCount ?? Math.max(1, progress.chapter + 1),
        progress.fraction,
      )
    : 0
}

export function readerMotionSafeScrollBehavior(preferred: ScrollBehavior): ScrollBehavior {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : preferred
}
