import { useEffect, useRef, useState, type RefObject } from 'react'
import { resourceMessageBindingDraft, snippetMessageBindingDraft } from '@localixai/mini-app-sdk/ui'
import { miniAppComposer } from '@localixai/mini-app-sdk/ui/runtime'

import type { ReaderChapter, ReaderDocument, ReaderSource } from '../shared/contracts'
import { readerChapterUri } from '../shared/resource-uri'
import { readerApi } from './api'
import { readerNotePreview, readerNoteReferenceStrength, sanitizeReaderHtml } from './model'
import type { ReaderNotePopoverValue } from './ReaderNotePopover'

/** Footnote and endnote previews: the popover, its request sequencing and its ARIA wiring. */
export function useReaderNotes({
  articleRef,
  sessionId,
  source,
  sourceKey,
  document,
  chapter,
  loadedChapterIndex,
  displayBookTitle,
}: {
  articleRef: RefObject<HTMLElement | null>
  sessionId: string
  source: ReaderSource
  sourceKey: string
  document: ReaderDocument | null
  chapter: ReaderChapter | null
  loadedChapterIndex: number
  displayBookTitle: string
}) {
  const [notePopover, setNotePopover] = useState<ReaderNotePopoverValue | null>(null)
  const noteRequestRef = useRef(0)

  const closeNotePopover = () => {
    noteRequestRef.current += 1
    setNotePopover((current) => {
      current?.origin.setAttribute('aria-expanded', 'false')
      return null
    })
  }

  const openReaderNote = (anchor: HTMLAnchorElement): boolean => {
    const href = anchor.getAttribute('href')?.trim()
    if (!href) return false
    const strength = readerNoteReferenceStrength(anchor)
    if (!strength) return false
    const linkedChapter = Number(anchor.dataset.readerChapter)
    const targetChapter =
      Number.isInteger(linkedChapter) && linkedChapter >= 0 ? linkedChapter : loadedChapterIndex
    const fragment = anchor.dataset.readerFragment ?? (href.startsWith('#') ? href.slice(1) : '')
    if (!fragment) return false
    const chapterTitle = document?.chapters[targetChapter]?.title ?? chapter?.title ?? 'Book note'
    const rect = anchor.getBoundingClientRect()
    const base = {
      anchor: {
        x: Math.max(8, Math.min(globalThis.innerWidth - 8, rect.left)),
        y: Math.max(8, Math.min(globalThis.innerHeight - 8, rect.bottom)),
      },
      chapter: targetChapter,
      chapterTitle,
      fragment,
      origin: anchor,
    }
    if (targetChapter === loadedChapterIndex && articleRef.current) {
      const preview = readerNotePreview(articleRef.current, fragment, strength)
      if (!preview) return false
      noteRequestRef.current += 1
      setNotePopover((current) => {
        if (current?.origin !== anchor) current?.origin.setAttribute('aria-expanded', 'false')
        anchor.setAttribute('aria-haspopup', 'dialog')
        anchor.setAttribute('aria-expanded', 'true')
        return { ...base, status: 'ready', preview }
      })
      return true
    }
    if (strength !== 'definite') return false
    const request = noteRequestRef.current + 1
    noteRequestRef.current = request
    setNotePopover((current) => {
      if (current?.origin !== anchor) current?.origin.setAttribute('aria-expanded', 'false')
      anchor.setAttribute('aria-haspopup', 'dialog')
      anchor.setAttribute('aria-expanded', 'true')
      return { ...base, status: 'loading' }
    })
    void readerApi
      .chapter(source, targetChapter)
      .then(({ chapter: target }) => {
        if (noteRequestRef.current !== request) return
        if (target.kind !== 'html') throw new Error('This note is not available as rich text')
        const root = globalThis.document.createElement('article')
        root.innerHTML = sanitizeReaderHtml(target.content)
        const preview = readerNotePreview(root, fragment, strength)
        if (!preview) throw new Error('The linked note could not be located')
        setNotePopover((current) =>
          current?.origin === anchor ? { ...current, status: 'ready', preview } : current,
        )
      })
      .catch((cause) => {
        if (noteRequestRef.current !== request) return
        setNotePopover((current) =>
          current?.origin === anchor
            ? {
                ...current,
                status: 'error',
                error: cause instanceof Error ? cause.message : String(cause),
              }
            : current,
        )
      })
    return true
  }

  const attachNoteContext = () => {
    if (!document || !notePopover?.preview) return
    miniAppComposer.insert({
      sessionId,
      bindings: [
        resourceMessageBindingDraft({
          uri: readerChapterUri(source, notePopover.chapter),
          label: `${displayBookTitle} · ${notePopover.chapterTitle}`,
        }),
        snippetMessageBindingDraft({
          label: `${notePopover.preview.title} · ${notePopover.chapterTitle}`,
          content: notePopover.preview.text,
          language: 'text',
        }),
      ],
    })
    // The chips landing in the composer are the confirmation.
  }

  // Another chapter or book has no note open: closed in the render that shows it, and any
  // preview still being fetched for the old one is dropped.
  const popoverScope = `${sourceKey}:${loadedChapterIndex}`
  const [shownScope, setShownScope] = useState(popoverScope)
  if (shownScope !== popoverScope) {
    setShownScope(popoverScope)
    setNotePopover(null)
  }
  useEffect(() => {
    noteRequestRef.current += 1
  }, [popoverScope])

  // Whichever way a note's link stops being the open one, it no longer says it is expanded.
  const openOrigin = notePopover?.origin
  useEffect(() => () => openOrigin?.setAttribute('aria-expanded', 'false'), [openOrigin])

  useEffect(() => {
    if (chapter?.kind !== 'html') return
    let noteAnchors: HTMLAnchorElement[] = []
    const frame = requestAnimationFrame(() => {
      const root = articleRef.current
      if (!root) return
      noteAnchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]')).filter(
        (anchor) => readerNoteReferenceStrength(anchor) === 'definite',
      )
      for (const anchor of noteAnchors) {
        anchor.setAttribute('aria-haspopup', 'dialog')
        anchor.setAttribute('aria-expanded', 'false')
      }
    })
    return () => {
      cancelAnimationFrame(frame)
      for (const anchor of noteAnchors) {
        anchor.removeAttribute('aria-haspopup')
        anchor.removeAttribute('aria-expanded')
      }
    }
  }, [articleRef, chapter])

  return { notePopover, closeNotePopover, openReaderNote, attachNoteContext }
}
