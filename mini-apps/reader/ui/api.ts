import { miniAppApiFetch } from '@localixai/mini-app-sdk/ui'

import type {
  ReaderBookMetadataPatch,
  ReaderBookSummary,
  ReaderChapterResponse,
  ReaderCollection,
  ReaderDocumentResponse,
  ReaderLibraryResponse,
  ReaderLibrarySearchResponse,
  ReaderSearchOptions,
  ReaderSearchResponse,
  ReaderSource,
  ReaderReadingEventInput,
  ReaderStatsResponse,
} from '../shared/contracts'

const BASE = '/rpc/reader'

export class ReaderApiError extends Error {
  /** The parser's own words, when a foreign one produced them. Event Center only. */
  readonly detail?: string
  constructor(message: string, detail?: string) {
    super(message)
    this.name = 'ReaderApiError'
    this.detail = detail
  }
}

async function readOr<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string; detail?: string })
    | null
  if (!response.ok || !body || typeof body.error === 'string') {
    throw new ReaderApiError(
      body?.error ?? `Reader request failed (${response.status})`,
      body?.detail,
    )
  }
  return body
}

function sourceQuery(source: ReaderSource): URLSearchParams {
  return 'path' in source
    ? new URLSearchParams({ path: source.path })
    : new URLSearchParams({
        mediaId: source.mediaId,
        ...(source.name ? { name: source.name } : {}),
      })
}

export const readerApi = {
  async library(): Promise<ReaderLibraryResponse> {
    return readOr<ReaderLibraryResponse>(await miniAppApiFetch(`${BASE}/library`))
  },

  async searchLibrary(
    queryValue: string,
    signal?: AbortSignal,
  ): Promise<ReaderLibrarySearchResponse> {
    const query = new URLSearchParams({ query: queryValue, limit: '100' })
    return readOr<ReaderLibrarySearchResponse>(
      await miniAppApiFetch(`${BASE}/library/search?${query}`, { signal }),
    )
  },

  async document(source: ReaderSource): Promise<ReaderDocumentResponse> {
    const query = sourceQuery(source)
    return readOr<ReaderDocumentResponse>(await miniAppApiFetch(`${BASE}/document?${query}`))
  },

  async chapter(source: ReaderSource, chapter: number): Promise<ReaderChapterResponse> {
    const query = sourceQuery(source)
    query.set('chapter', String(chapter))
    return readOr<ReaderChapterResponse>(await miniAppApiFetch(`${BASE}/chapter?${query}`))
  },

  async search(
    source: ReaderSource,
    options: ReaderSearchOptions,
    signal?: AbortSignal,
  ): Promise<ReaderSearchResponse> {
    const query = sourceQuery(source)
    query.set('query', options.query)
    query.set('scope', options.scope)
    if (options.chapter !== undefined) query.set('chapter', String(options.chapter))
    query.set('mode', options.mode)
    query.set('matchCase', String(options.matchCase))
    query.set('matchDiacritics', String(options.matchDiacritics))
    query.set('nearbyWords', String(options.nearbyWords))
    query.set('limit', String(options.limit))
    return readOr<ReaderSearchResponse>(
      await miniAppApiFetch(`${BASE}/search?${query}`, { signal }),
    )
  },

  async stats(source: ReaderSource): Promise<ReaderStatsResponse> {
    const query = sourceQuery(source)
    return readOr<ReaderStatsResponse>(await miniAppApiFetch(`${BASE}/stats?${query}`))
  },

  async recordReadingEvent(event: ReaderReadingEventInput): Promise<boolean> {
    return (
      await readOr<{ recorded: boolean }>(
        await miniAppApiFetch(`${BASE}/stats/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(event),
          keepalive: true,
        }),
      )
    ).recorded
  },

  async remove(source: ReaderSource): Promise<boolean> {
    const query = sourceQuery(source)
    return (
      await readOr<{ removed: boolean }>(
        await miniAppApiFetch(`${BASE}/library?${query}`, { method: 'DELETE' }),
      )
    ).removed
  },

  async removeMany(sources: ReaderSource[]): Promise<number> {
    return (
      await readOr<{ removed: number }>(
        await miniAppApiFetch(`${BASE}/library/bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'remove', sources }),
        }),
      )
    ).removed
  },

  async updateMetadata(
    source: ReaderSource,
    patch: ReaderBookMetadataPatch,
  ): Promise<ReaderBookSummary> {
    const query = sourceQuery(source)
    return (
      await readOr<{ book: ReaderBookSummary }>(
        await miniAppApiFetch(`${BASE}/library/book?${query}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        }),
      )
    ).book
  },

  async setCollections(
    sources: ReaderSource[],
    collectionIds: string[],
  ): Promise<ReaderBookSummary[]> {
    return (
      await readOr<{ books: ReaderBookSummary[] }>(
        await miniAppApiFetch(`${BASE}/library/bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'setCollections', sources, collectionIds }),
        }),
      )
    ).books
  },

  async changeCollections(
    sources: ReaderSource[],
    addCollectionIds: string[],
    removeCollectionIds: string[],
  ): Promise<ReaderBookSummary[]> {
    return (
      await readOr<{ books: ReaderBookSummary[] }>(
        await miniAppApiFetch(`${BASE}/library/bulk`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'changeCollections',
            sources,
            addCollectionIds,
            removeCollectionIds,
          }),
        }),
      )
    ).books
  },

  async createCollection(name: string): Promise<ReaderCollection> {
    return (
      await readOr<{ collection: ReaderCollection }>(
        await miniAppApiFetch(`${BASE}/library/collections`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      )
    ).collection
  },

  async renameCollection(id: string, name: string): Promise<ReaderCollection> {
    return (
      await readOr<{ collection: ReaderCollection }>(
        await miniAppApiFetch(`${BASE}/library/collections/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
      )
    ).collection
  },

  async removeCollection(id: string): Promise<boolean> {
    return (
      await readOr<{ removed: boolean }>(
        await miniAppApiFetch(`${BASE}/library/collections/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        }),
      )
    ).removed
  },
}
