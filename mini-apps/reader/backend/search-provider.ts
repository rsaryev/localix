import {
  bestFieldScore,
  type SearchHit,
  type SearchProvider,
  type SearchQuery,
} from '@localixai/mini-app-sdk/backend'

import { readerBookUri, readerChapterUri } from '../shared/resource-uri'
import type { ReaderService } from './service'

export function createReaderSearchProvider(service: ReaderService): SearchProvider {
  return {
    id: 'reader:library',
    title: 'Reader',
    tier: 'eager',
    icon: 'book',
    async search(_userId: string, query: SearchQuery): Promise<SearchHit[]> {
      try {
        const needle = query.text.trim()
        if (!needle) return []
        const library = await service.list()
        const metadataHits = library.books
          .map((book) => ({ book, score: bestFieldScore([book.title, book.path], needle) }))
          .filter(({ score }) => score > 0)
          .sort(
            (left, right) =>
              right.score - left.score || left.book.title.localeCompare(right.book.title),
          )
          .slice(0, query.limitPerProvider ?? 30)
          .map(({ book, score }) => ({
            id: readerBookUri(
              book.mediaId ? { mediaId: book.mediaId, name: book.path } : { path: book.path },
            ),
            domain: 'reader:library',
            title: book.title,
            subtitle: book.path,
            icon: 'book',
            score,
          }))
        if (!query.domains?.includes('reader:library')) return metadataHits
        const remaining = Math.max(0, (query.limitPerProvider ?? 30) - metadataHits.length)
        if (!remaining) return metadataHits
        const content = await service.searchLibrary('', query.text, { limit: remaining })
        return [
          ...metadataHits,
          ...content.hits.map(({ book, match }) => {
            const source = book.mediaId
              ? { mediaId: book.mediaId, name: book.path }
              : { path: book.path }
            return {
              id: `${readerChapterUri(source, match.chapter)}#match=${encodeURIComponent(match.id)}`,
              uri: readerChapterUri(source, match.chapter),
              domain: 'reader:library',
              title: `${book.title} · ${match.chapterTitle}`,
              subtitle: book.path,
              snippet: `${match.before} [${match.match}] ${match.after}`.trim(),
              icon: 'chapter',
              score: 0.82,
            }
          }),
        ]
      } catch {
        return []
      }
    },
  }
}
