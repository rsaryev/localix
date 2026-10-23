import { useEffect, useRef, type RefObject } from 'react'

import type { ReaderChapter } from '../shared/contracts'
import { findReaderTextRange, type ReaderSavedQuote } from './model'

/** Wraps this chapter's saved annotations in `<mark>`s, the first segment of each focusable. */
export function useReaderAnnotationMarks({
  articleRef,
  chapter,
  quotes,
  activeAnnotationId,
}: {
  articleRef: RefObject<HTMLElement | null>
  chapter: ReaderChapter | null
  quotes: ReaderSavedQuote[]
  activeAnnotationId: string | null
}) {
  const annotationCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    annotationCleanupRef.current?.()
    annotationCleanupRef.current = null
    if (!chapter || !articleRef.current) return
    const chapterAnnotations = quotes.filter((item) => item.chapter === chapter.index)
    if (!chapterAnnotations.length) return
    const frame = requestAnimationFrame(() => {
      const root = articleRef.current
      if (!root) return
      const marks: HTMLElement[] = []
      for (const annotation of chapterAnnotations.toReversed()) {
        const found = findReaderTextRange(root, annotation.target ?? { quote: annotation.quote })
        if (!found) continue
        let interactiveSegment = true
        for (const segment of found.segments) {
          if (!segment.node.isConnected) continue
          const range = globalThis.document.createRange()
          range.setStart(segment.node, segment.start)
          range.setEnd(segment.node, segment.end)
          const mark = globalThis.document.createElement('mark')
          mark.className = 'reader-annotation'
          mark.dataset.readerAnnotationId = annotation.id
          mark.dataset.color = annotation.color ?? 'yellow'
          if (annotation.id === activeAnnotationId) mark.dataset.active = 'true'
          if (annotation.note) mark.title = annotation.note
          if (interactiveSegment) {
            mark.tabIndex = 0
            mark.setAttribute('role', 'button')
            mark.setAttribute(
              'aria-label',
              annotation.note
                ? `Highlighted passage. Note: ${annotation.note}`
                : `Highlighted passage: ${annotation.quote.slice(0, 160)}`,
            )
            interactiveSegment = false
          }
          range.surroundContents(mark)
          marks.push(mark)
        }
      }
      annotationCleanupRef.current = () => {
        for (const mark of marks.toReversed()) {
          const parent = mark.parentNode
          if (!parent) continue
          mark.replaceWith(...mark.childNodes)
          parent.normalize()
        }
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      annotationCleanupRef.current?.()
      annotationCleanupRef.current = null
    }
  }, [activeAnnotationId, articleRef, chapter, quotes])
}
