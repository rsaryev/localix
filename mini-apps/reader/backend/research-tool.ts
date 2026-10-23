import type { MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { realpath } from 'node:fs/promises'

import type { ReaderSource } from '../shared/contracts'
import { readerChapterUri } from '../shared/resource-uri'
import { searchReaderChapters } from '../shared/search'
import type { ReaderService } from './service'

const MAX_READ_CHARS = 32_000
const DEFAULT_READ_CHARS = 16_000

async function explicitDocument(service: ReaderService, source: ReaderSource) {
  const library = await service.list()
  const canonicalPath =
    'path' in source ? await realpath(source.path).catch(() => source.path) : undefined
  const mediaId = 'mediaId' in source ? source.mediaId : undefined
  const book = library.books.find((candidate) =>
    canonicalPath !== undefined ? candidate.path === canonicalPath : candidate.mediaId === mediaId,
  )
  if (!book) throw new Error('Book is not in the explicit Reader library')
  const canonical: ReaderSource = book.mediaId
    ? { mediaId: book.mediaId, name: book.path }
    : { path: book.path }
  const parsed =
    'path' in canonical
      ? await service.read('', canonical.path, { remember: false })
      : await service.readMedia(canonical.mediaId, canonical.name, { remember: false })
  return { book, source: canonical, parsed }
}

function isHighSurrogate(value: string, index: number) {
  const code = value.charCodeAt(index)
  return code >= 0xd800 && code <= 0xdbff
}

function isLowSurrogate(value: string, index: number) {
  const code = value.charCodeAt(index)
  return code >= 0xdc00 && code <= 0xdfff
}

export function boundedReaderText(
  value: string,
  maxChars: number,
  requestedOffset = 0,
): { content: string; offset: number; nextOffset: number | null; truncated: boolean } {
  let offset = Math.max(0, Math.min(value.length, requestedOffset))
  if (offset > 0 && isLowSurrogate(value, offset)) offset -= 1
  let end = Math.min(value.length, offset + maxChars)
  if (end < value.length && isHighSurrogate(value, end - 1)) end -= 1
  return {
    content: value.slice(offset, end),
    offset,
    nextOffset: end < value.length ? end : null,
    truncated: end < value.length,
  }
}

/**
 * Read-only retrieval companion for Reader context bindings. It never discovers files: every
 * source must already be present in the user's explicit library. This lets an agent grounded on a
 * book/chapter link inspect the outline, fetch bounded chapter text, or search for corroborating
 * passages without asking the UI to paste source text into the user's message.
 */
export function createReaderResearchTool(ctx: MiniAppContext, service: ReaderService) {
  const source = ctx.z.union([
    ctx.z.object({ path: ctx.z.string().trim().min(1).max(4_096) }).strict(),
    ctx.z
      .object({
        mediaId: ctx.z.string().trim().min(1).max(512),
        name: ctx.z.string().trim().min(1).max(512).optional(),
      })
      .strict(),
  ])
  const inputSchema = ctx.z.discriminatedUnion('action', [
    ctx.z.object({ action: ctx.z.literal('library') }).strict(),
    ctx.z.object({ action: ctx.z.literal('outline'), source }).strict(),
    ctx.z
      .object({
        action: ctx.z.literal('read'),
        source,
        chapter: ctx.z.number().int().min(0).max(100_000),
        offset: ctx.z.number().int().min(0).max(100_000_000).default(0),
        maxChars: ctx.z.number().int().min(1_000).max(MAX_READ_CHARS).default(DEFAULT_READ_CHARS),
      })
      .strict(),
    ctx.z
      .object({
        action: ctx.z.literal('search'),
        source,
        query: ctx.z.string().trim().min(1).max(256),
        limit: ctx.z.number().int().min(1).max(50).default(12),
      })
      .strict(),
  ])

  return ctx.defineTool({
    name: 'reader_research',
    label: 'Research book',
    activeVerb: 'Reading linked book',
    description: [
      'Inspect books that the user explicitly opened in Reader.',
      'Use library to list allowed sources, outline for chapter identities, read for one bounded',
      'chapter chunk, and search to retrieve exact corroborating passages across a book.',
      'Continue a long chapter by passing each read result’s nextOffset back as offset until null.',
      'Prefer the source from the attached Reader resource. Chapter indexes are zero-based.',
      'This tool is read-only and never scans folders, imports books, or modifies source files.',
    ].join(' '),
    inputSchema,
    executionMode: 'parallel',
    mutates: false,
    async execute(_toolCallId, input) {
      try {
        if (input.action === 'library') {
          const library = await service.list()
          return {
            content: JSON.stringify(
              {
                books: library.books.map((book) => ({
                  title: book.title,
                  author: book.author,
                  format: book.format,
                  source: book.mediaId
                    ? { mediaId: book.mediaId, name: book.path }
                    : { path: book.path },
                })),
              },
              null,
              2,
            ),
          }
        }

        const { book, source: canonical, parsed } = await explicitDocument(service, input.source)
        if (input.action === 'outline') {
          return {
            content: JSON.stringify(
              {
                title: book.title,
                author: book.author,
                format: book.format,
                wordCount: parsed.document.wordCount,
                chapters: parsed.document.chapters.map((chapter) => ({
                  index: chapter.index,
                  title: chapter.title,
                  wordCount: chapter.wordCount,
                  resourceUri: readerChapterUri(canonical, chapter.index),
                })),
              },
              null,
              2,
            ),
          }
        }

        if (input.action === 'read') {
          const chapter = parsed.chapters[input.chapter]
          if (!chapter) throw new Error('Reader chapter not found')
          const passage = boundedReaderText(chapter.text, input.maxChars, input.offset)
          return {
            content: JSON.stringify(
              {
                title: book.title,
                chapter: chapter.index,
                chapterTitle: chapter.title,
                resourceUri: readerChapterUri(canonical, chapter.index),
                totalChars: chapter.text.length,
                ...passage,
              },
              null,
              2,
            ),
          }
        }

        const result = searchReaderChapters(parsed.chapters, {
          query: input.query,
          scope: 'book',
          mode: 'contains',
          matchCase: false,
          matchDiacritics: false,
          nearbyWords: 10,
          limit: input.limit,
        })
        return {
          content: JSON.stringify(
            {
              title: book.title,
              query: result.query,
              total: result.total,
              truncated: result.truncated,
              matches: result.groups.flatMap((group) =>
                group.matches.map((match) => ({
                  chapter: match.chapter,
                  chapterTitle: match.chapterTitle,
                  resourceUri: readerChapterUri(canonical, match.chapter),
                  excerpt: [match.before, match.match, match.after].filter(Boolean).join(' '),
                })),
              ),
            },
            null,
            2,
          ),
        }
      } catch (error) {
        return {
          content: error instanceof Error ? error.message : String(error),
          isError: true,
        }
      }
    },
  })
}
