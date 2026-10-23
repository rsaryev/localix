import type { RefObject } from 'react'
import {
  resourceMessageBindingDraft,
  snippetMessageBindingDraft,
  toast,
} from '@localixai/mini-app-sdk/ui'
import { miniAppComposer, miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import type { ReaderChapter, ReaderDocument, ReaderSource } from '../shared/contracts'
import { readerChapterUri } from '../shared/resource-uri'
import {
  parseReaderAnnotationExport,
  type ReaderHighlightColor,
  type ReaderPreferences,
  type ReaderSavedQuote,
  type ReaderTextTarget,
} from './model'
import { readerAnnotationExportFileName } from './readerPaneModel'

/** Creating, attaching, exporting and importing this book's annotations. */
export function useReaderAnnotationActions({
  sessionId,
  source,
  sourceKey,
  document,
  chapter,
  displayBookTitle,
  displayBookAuthor,
  selectionTarget,
  clearSelection,
  quotes,
  saveQuote,
  importQuotes,
  preferences,
  setPreferences,
  annotationImportRef,
  showAnnotations,
  setActiveAnnotationId,
  setEditingAnnotationId,
}: {
  sessionId: string
  source: ReaderSource
  sourceKey: string
  document: ReaderDocument | null
  chapter: ReaderChapter | null
  displayBookTitle: string
  displayBookAuthor: string | undefined
  selectionTarget: ReaderTextTarget | null
  clearSelection: () => void
  quotes: ReaderSavedQuote[]
  saveQuote: (quote: ReaderSavedQuote) => string
  importQuotes: (quotes: ReaderSavedQuote[]) => void
  preferences: ReaderPreferences
  setPreferences: (preferences: ReaderPreferences) => void
  annotationImportRef: RefObject<HTMLInputElement | null>
  /** Opens the book panel on its annotations tab. */
  showAnnotations: () => void
  setActiveAnnotationId: (id: string | null) => void
  setEditingAnnotationId: (id: string | null) => void
}) {
  const attachAnnotationContext = (item: ReaderSavedQuote) => {
    if (!document) return
    const uri = readerChapterUri(source, item.chapter)
    miniAppComposer.insert({
      sessionId,
      bindings: [
        resourceMessageBindingDraft({
          uri,
          label: `${displayBookTitle} · ${item.chapterTitle}`,
        }),
        snippetMessageBindingDraft({
          label: item.note ? `Note · ${item.chapterTitle}` : `Highlight · ${item.chapterTitle}`,
          content: item.note ? `${item.quote}\n\nNote: ${item.note}` : item.quote,
          language: 'text',
        }),
      ],
    })
  }

  const createAnnotation = (color: ReaderHighlightColor, editNote = false) => {
    if (!selectionTarget || !document || !chapter) return
    const id = saveQuote({
      id: crypto.randomUUID(),
      source,
      path: sourceKey,
      bookTitle: displayBookTitle,
      chapter: chapter.index,
      chapterTitle: chapter.title,
      quote: selectionTarget.quote,
      target: selectionTarget,
      color,
      note: '',
      createdAt: new Date().toISOString(),
    })
    if (preferences.highlightColor !== color) {
      setPreferences({ ...preferences, highlightColor: color })
    }
    setActiveAnnotationId(id)
    setEditingAnnotationId(editNote ? id : null)
    showAnnotations()
    clearSelection()
  }

  const exportAnnotations = async () => {
    if (!document || !quotes.length) return
    const payload = {
      schema: 'localix.reader.annotations',
      version: 1,
      book: { title: displayBookTitle, author: displayBookAuthor, source },
      annotations: quotes,
      exportedAt: new Date().toISOString(),
    }
    try {
      // The host's save (a download or a desktop save) is its own confirmation.
      await miniAppFiles.saveBlob(
        readerAnnotationExportFileName(displayBookTitle),
        new Blob([JSON.stringify(payload, null, 2)], {
          type: 'application/json',
        }),
      )
    } catch (cause) {
      toast.error('Could not export annotations', {
        description: errorMessage(cause, '') || undefined,
      })
    }
  }

  const importAnnotations = async (file: File) => {
    if (!document) return
    try {
      const parsed = parseReaderAnnotationExport(JSON.parse(await file.text()))
      const portable = parsed
        .filter((item) => item.chapter < document.chapters.length)
        .map((item) => ({
          ...item,
          source,
          path: sourceKey,
          bookTitle: displayBookTitle,
          chapterTitle: document.chapters[item.chapter]?.title ?? item.chapterTitle,
        }))
      if (!portable.length) throw new Error('No annotations match chapters in this book')
      importQuotes(portable)
      // The saved panel opening on the imported notes is the confirmation.
      showAnnotations()
    } catch (cause) {
      toast.error('Could not import annotations', {
        description: errorMessage(cause, '') || undefined,
      })
    } finally {
      if (annotationImportRef.current) annotationImportRef.current.value = ''
    }
  }

  const openAnnotationEditor = (id: string | null) => {
    if (!id) return
    setActiveAnnotationId(id)
    setEditingAnnotationId(id)
    showAnnotations()
  }

  return {
    attachAnnotationContext,
    createAnnotation,
    exportAnnotations,
    importAnnotations,
    openAnnotationEditor,
  }
}
