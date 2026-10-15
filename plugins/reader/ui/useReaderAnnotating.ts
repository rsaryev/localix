import type { RefObject } from 'react'

import type { ReaderChapter, ReaderDocument, ReaderSource } from '../shared/contracts'
import type { ReaderPreferences } from './model'
import type { useSavedQuotes } from './readerStorage'
import { useReaderAnnotationActions } from './useReaderAnnotationActions'
import { useReaderArticleLinks } from './useReaderArticleLinks'
import { useReaderNotes } from './useReaderNotes'
import type { useReaderTextSelection } from './useReaderTextSelection'

/** The open book as the annotation, note and link hooks see it. */
export interface ReaderAnnotatingBook {
  sessionId: string
  source: ReaderSource
  sourceKey: string
  document: ReaderDocument | null
  chapter: ReaderChapter | null
  loadedChapterIndex: number
  displayBookTitle: string
  displayBookAuthor: string | undefined
}

/**
 * What the reader does with the text itself: annotation actions, footnote popovers and
 * in-article links. (Highlight marks stay with the pane, ahead of target reveal.) Links route through annotations and notes, so they wire here.
 */
export function useReaderAnnotating({
  refs,
  book,
  textSelection,
  savedQuotes,
  preferences,
  setPreferences,
  annotationState,
  actions,
}: {
  refs: {
    article: RefObject<HTMLElement | null>
    importInput: RefObject<HTMLInputElement | null>
  }
  book: ReaderAnnotatingBook
  textSelection: ReturnType<typeof useReaderTextSelection>
  savedQuotes: ReturnType<typeof useSavedQuotes>
  preferences: ReaderPreferences
  setPreferences: (next: ReaderPreferences) => void
  annotationState: {
    setActiveId: (id: string | null) => void
    setEditingId: (id: string | null) => void
  }
  actions: {
    showAnnotations: () => void
    navigateReader: Parameters<typeof useReaderArticleLinks>[0]['navigateReader']
    moveParagraphFocus: Parameters<typeof useReaderArticleLinks>[0]['moveParagraphFocus']
  }
}) {
  const { loadedChapterIndex, displayBookAuthor, ...noteBook } = book
  const { quotes } = savedQuotes
  const annotations = useReaderAnnotationActions({
    ...noteBook,
    displayBookAuthor,
    selectionTarget: textSelection.selectionTarget,
    clearSelection: textSelection.clearSelection,
    quotes,
    saveQuote: savedQuotes.save,
    importQuotes: savedQuotes.importMany,
    preferences,
    setPreferences,
    annotationImportRef: refs.importInput,
    showAnnotations: actions.showAnnotations,
    setActiveAnnotationId: annotationState.setActiveId,
    setEditingAnnotationId: annotationState.setEditingId,
  })
  const notes = useReaderNotes({ articleRef: refs.article, loadedChapterIndex, ...noteBook })
  const links = useReaderArticleLinks({
    articleRef: refs.article,
    loadedChapterIndex,
    noteChapter: notes.notePopover?.chapter,
    openReaderNote: notes.openReaderNote,
    closeNotePopover: notes.closeNotePopover,
    navigateReader: actions.navigateReader,
    openAnnotationEditor: annotations.openAnnotationEditor,
    moveParagraphFocus: actions.moveParagraphFocus,
  })
  return { annotations, notes, links }
}
