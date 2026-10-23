import type {
  ResourceExpansion,
  ResourceNode,
  ResourceRefProvider,
  ResourceRefScope,
} from '@localixai/mini-app-sdk/backend'
import { isAbsolute } from 'node:path'

import { READER_PROVIDER } from '../shared/contracts'
import type { ReaderSource } from '../shared/contracts'
import {
  parseReaderUri,
  readerBookUri,
  readerChapterUri,
  readerRootUri,
} from '../shared/resource-uri'
import type { ReaderService } from './service'

const MAX_EXPANSION_CHARS = 48_000

function sourceLabel(source: ReaderSource): string {
  return 'path' in source ? source.path : (source.name ?? source.mediaId)
}

async function readSource(
  service: ReaderService,
  userId: string,
  scope: ResourceRefScope | undefined,
  source: ReaderSource,
) {
  if ('mediaId' in source)
    return service.readMedia(source.mediaId, source.name, { remember: false })
  const root = isAbsolute(source.path)
    ? null
    : scope?.sessionId
      ? await service.resolveSessionRoot(userId, scope.sessionId)
      : null
  if (!root && !isAbsolute(source.path)) {
    throw new Error('An active project session is required for a relative book path')
  }
  return service.read(root ?? '', source.path, { remember: false })
}

function includes(values: string[], query?: string): boolean {
  const needle = query?.trim().toLocaleLowerCase()
  return !needle || values.some((value) => value.toLocaleLowerCase().includes(needle))
}

function bounded(value: string): string {
  return value.length <= MAX_EXPANSION_CHARS
    ? value
    : `${value.slice(0, MAX_EXPANSION_CHARS)}\n\n… [reader context truncated]`
}

export function createReaderResourceProvider(service: ReaderService): ResourceRefProvider {
  return {
    provider: READER_PROVIDER,
    title: 'Reader',
    async listChildren(userId, parentUri, query, scope): Promise<ResourceNode[]> {
      if (parentUri === null || parentUri === readerRootUri()) {
        const library = await service.list()
        return library.books
          .filter((book) => includes([book.title, book.path, book.format], query))
          .map((book) => ({
            uri: readerBookUri(
              book.mediaId ? { mediaId: book.mediaId, name: book.path } : { path: book.path },
            ),
            label: book.title,
            detail: `${book.format.toUpperCase()} · ${book.path}`,
            hasChildren: true,
            icon: 'book',
          }))
      }
      const resource = parseReaderUri(parentUri)
      if (resource?.kind !== 'book') return []
      const parsed = await readSource(service, userId, scope, resource.source)
      return parsed.document.chapters
        .filter((item) => includes([item.title], query))
        .map((item) => ({
          uri: readerChapterUri(resource.source, item.index),
          label: item.title,
          detail: `${item.wordCount.toLocaleString()} words`,
          hasChildren: false,
          icon: 'chapter',
        }))
    },
    async expand(userId, uri, scope): Promise<ResourceExpansion> {
      const resource = parseReaderUri(uri)
      if (!resource) return { ok: false, error: 'Not a Reader resource' }
      if (resource.kind === 'root') {
        const library = await service.list()
        return {
          ok: true,
          language: 'markdown',
          content: [
            '# Reader library',
            '',
            ...library.books.map(
              (book) =>
                `- [${book.title}](${readerBookUri(book.mediaId ? { mediaId: book.mediaId, name: book.path } : { path: book.path })}) — ${book.format.toUpperCase()} · ${book.path}`,
            ),
          ].join('\n'),
        }
      }
      const parsed = await readSource(service, userId, scope, resource.source)
      if (resource.kind === 'book') {
        const document = parsed.document
        return {
          ok: true,
          language: 'markdown',
          content: [
            `# ${document.title}`,
            document.author ? `Author: ${document.author}` : '',
            `Format: ${document.format.toUpperCase()} · ${document.wordCount.toLocaleString()} words`,
            `Source: ${document.path}`,
            '',
            '## Contents',
            ...document.chapters.map(
              (item) =>
                `${item.index + 1}. [${item.title}](${readerChapterUri(resource.source, item.index)}) — ${item.wordCount.toLocaleString()} words`,
            ),
          ]
            .filter(Boolean)
            .join('\n'),
        }
      }
      const chapter = parsed.chapters[resource.chapter]
      if (!chapter) return { ok: false, error: 'Chapter not found' }
      return {
        ok: true,
        language: chapter.kind === 'markdown' ? 'markdown' : 'text',
        content: bounded(
          [
            `# ${parsed.document.title} — ${chapter.title}`,
            `Source: ${sourceLabel(resource.source)} · chapter ${chapter.index + 1} of ${parsed.document.chapters.length}`,
            '',
            chapter.kind === 'markdown' ? chapter.content : chapter.text,
          ].join('\n'),
        ),
      }
    },
  }
}
