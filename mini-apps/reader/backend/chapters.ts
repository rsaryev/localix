import { basename, extname } from 'node:path'
import { parse as parseHtml } from 'node-html-parser'
import type { ReaderChapter, ReaderDocument, ReaderFormat } from '../shared/contracts'

export const MAX_CHAPTERS = 400
const MAX_CHAPTER_TEXT = 500_000
// Markup may legitimately contain bounded, inlined EPUB illustrations. Keep a
// separate ceiling so an image data URI is never sliced into invalid HTML.
const MAX_CHAPTER_MARKUP = 6 * 1024 * 1024

export interface ParsedReaderDocument {
  document: ReaderDocument
  chapters: ReaderChapter[]
  cover?: string
}

export function titleFromPath(path: string): string {
  return basename(path, extname(path)).replaceAll(/[_-]+/g, ' ').trim() || basename(path)
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0
}

export function cleanText(value: string): string {
  return value
    .replaceAll('\u00a0', ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function safeChapterContent(value: string, limit = MAX_CHAPTER_TEXT): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}\n\n… [chapter truncated]`
}

export function safeChapterMarkup(value: string): string {
  if (value.length <= MAX_CHAPTER_MARKUP) return value
  // Never cut through an element or a data URI. An exceptionally large chapter
  // falls back to readable text while preserving the bounded transport contract.
  const root = parseHtml(value, { lowerCaseTagName: true, comment: false })
  return `<p>${escapeHtml(safeChapterContent(cleanText(root.structuredText)))}</p>`
}

export function chapter(
  index: number,
  title: string,
  kind: ReaderChapter['kind'],
  content: string,
  text: string,
  id = `chapter-${index + 1}`,
): ReaderChapter {
  const cleaned = cleanText(text)
  return {
    id,
    index,
    title: title.trim() || `Chapter ${index + 1}`,
    kind,
    content:
      kind === 'html' ? safeChapterMarkup(content.trim()) : safeChapterContent(content.trim()),
    text: safeChapterContent(cleaned),
    wordCount: wordCount(cleaned),
  }
}

export function documentFromChapters(
  path: string,
  format: ReaderFormat,
  title: string,
  chapters: ReaderChapter[],
  metadata: { author?: string; language?: string } = {},
): ParsedReaderDocument {
  const normalized = chapters.length
    ? chapters.slice(0, MAX_CHAPTERS).map((item, index) => ({ ...item, index }))
    : [chapter(0, title, 'text', '', 'No readable text was found.')]
  return {
    document: {
      path,
      title: title.trim() || titleFromPath(path),
      format,
      ...metadata,
      wordCount: normalized.reduce((sum, item) => sum + item.wordCount, 0),
      chapters: normalized.map(({ id, index, title: chapterTitle, wordCount: count }) => ({
        id,
        index,
        title: chapterTitle,
        wordCount: count,
      })),
    },
    chapters: normalized,
  }
}
