import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'

import type {
  MiniAppHelpers,
  MiniAppHostServices,
  WorkspaceScopeHost,
} from '@localixai/mini-app-sdk/backend'

import { BookCache, estimateParsedBytes } from './book-cache'
import { collectionName } from './presentation-fields'
import { bookFromMedia, bookFromPath, bookFromStorage, patchBookMetadata } from './book-record'
import {
  MAX_COLLECTIONS,
  MAX_COLLECTIONS_PER_BOOK,
  isLibraryState,
  type StoredReaderLibrary,
} from './library-state'
import {
  parseReaderBytes,
  parseReaderDocument,
  resolveReaderPath,
  type ParsedReaderDocument,
} from './library'
import type {
  ReaderBookMetadataPatch,
  ReaderBookSummary,
  ReaderCollection,
  ReaderLibraryResponse,
  ReaderSource,
} from '../shared/contracts'
import {
  DEFAULT_READER_SEARCH_OPTIONS,
  searchReaderChapters,
  type ReaderLibrarySearchResponse,
  type ReaderSearchOptions,
} from '../shared/search'

interface ReaderPersistence {
  filePath: string
  helpers: Pick<MiniAppHelpers, 'readJson' | 'writeJson'>
}

interface ReaderReadOptions {
  /** Only explicit opens may add/re-add a book to the library. */
  remember?: boolean
}

export class ReaderService {
  private workspaceScope?: WorkspaceScopeHost
  private media?: NonNullable<MiniAppHostServices['media']>
  private readonly documents = new BookCache<ParsedReaderDocument>(estimateParsedBytes)
  private readonly opened = new Map<string, ReaderBookSummary>()
  private readonly collections = new Map<string, ReaderCollection>()
  /** Invalidates in-flight explicit reads when the same book is removed. */
  private readonly libraryEpoch = new Map<string, number>()
  private readonly persistence?: ReaderPersistence
  private loadPromise?: Promise<void>
  private libraryStale = false
  private savePromise: Promise<void> = Promise.resolve()

  constructor(
    host?: Pick<MiniAppHostServices, 'workspaceScope' | 'media'>,
    persistence?: ReaderPersistence,
  ) {
    this.persistence = persistence
    this.bindHost(host)
  }

  bindHost(host?: Pick<MiniAppHostServices, 'workspaceScope' | 'media'>): void {
    if (host?.workspaceScope) this.workspaceScope = host.workspaceScope
    if (host?.media) this.media = host.media
  }

  resolveSessionRoot(userId: string, sessionId: string): Promise<string | null> {
    return this.workspaceScope?.resolveSessionRoot(userId, sessionId) ?? Promise.resolve(null)
  }

  resolveProjectRoot(userId: string, projectId: string): Promise<string | null> {
    return this.workspaceScope?.resolveProjectRoot(userId, projectId) ?? Promise.resolve(null)
  }

  async list(): Promise<ReaderLibraryResponse> {
    // Fallback/focus reads must also reconcile disk when the host cannot watch it.
    if (this.persistence) this.invalidateLibrary()
    await this.ensureLoaded()
    const books = [...this.opened.values()].sort(
      (left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.path.localeCompare(right.path),
    )
    const collections = [...this.collections.values()].sort(
      (left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }) ||
        left.id.localeCompare(right.id),
    )
    return { books, collections }
  }

  /** Resolves any accepted alias to the identity persisted on the explicit Reader shelf. */
  async librarySource(root: string, source: ReaderSource): Promise<ReaderSource | null> {
    await this.ensureLoaded()
    const [key] = await this.sourceKeys(root, [source])
    const book = key ? this.opened.get(key) : undefined
    if (!book) return null
    return book.mediaId ? { mediaId: book.mediaId, name: book.path } : { path: book.path }
  }

  async read(
    root: string,
    path: string,
    options: ReaderReadOptions = {},
  ): Promise<ParsedReaderDocument> {
    await this.ensureLoaded()
    const target = await resolveReaderPath(root, path)
    const metadata = await stat(target)
    const fingerprint = `${metadata.dev}:${metadata.ino}:${metadata.size}:${metadata.mtimeMs}`
    const key = `path\0${target}`
    const openedKey = `path:${target}`
    const epoch = this.libraryEpoch.get(openedKey) ?? 0
    const cached = this.documents.get(key)
    if (cached?.fingerprint === fingerprint) {
      if (options.remember !== false && (this.libraryEpoch.get(openedKey) ?? 0) === epoch) {
        await this.rememberPath(target, cached.parsed, metadata.size, metadata.mtime.toISOString())
      }
      return cached.parsed
    }
    const parsed = await parseReaderDocument(root, path)
    this.documents.set(key, { fingerprint, parsed })
    if (options.remember !== false && (this.libraryEpoch.get(openedKey) ?? 0) === epoch) {
      await this.rememberPath(target, parsed, metadata.size, metadata.mtime.toISOString())
    }
    return parsed
  }

  async readMedia(
    mediaId: string,
    name?: string,
    options: ReaderReadOptions = {},
  ): Promise<ParsedReaderDocument> {
    await this.ensureLoaded()
    if (!mediaId || mediaId.includes('\0')) throw new Error('Media id is required')
    const key = `media\0${mediaId}`
    const openedKey = `media:${mediaId}`
    const epoch = this.libraryEpoch.get(openedKey) ?? 0
    const cached = this.documents.get(key)
    if (cached) {
      if (options.remember !== false && (this.libraryEpoch.get(openedKey) ?? 0) === epoch) {
        await this.rememberMedia(mediaId, name, cached.parsed)
      }
      return cached.parsed
    }
    const bytes = await this.media?.getBytes(mediaId)
    if (!bytes) throw new Error('Uploaded book was not found')
    const parsed = await parseReaderBytes(name?.trim() || mediaId, bytes)
    this.documents.set(key, { fingerprint: mediaId, parsed })
    if (options.remember !== false && (this.libraryEpoch.get(openedKey) ?? 0) === epoch) {
      await this.rememberMedia(mediaId, name, parsed, bytes.byteLength)
    }
    return parsed
  }

  async remove(root: string, source: ReaderSource): Promise<boolean> {
    return (await this.removeMany(root, [source])) === 1
  }

  async removeMany(root: string, sources: ReaderSource[]): Promise<number> {
    await this.ensureLoaded()
    const keys = await this.sourceKeys(root, sources)
    let removed = 0
    for (const key of keys) {
      this.libraryEpoch.set(key, (this.libraryEpoch.get(key) ?? 0) + 1)
      if (this.opened.delete(key)) removed += 1
    }
    if (removed > 0) await this.persist()
    return removed
  }

  async updateMetadata(
    root: string,
    source: ReaderSource,
    patch: ReaderBookMetadataPatch,
  ): Promise<ReaderBookSummary> {
    await this.ensureLoaded()
    const key = (await this.sourceKeys(root, [source]))[0]!
    const current = this.opened.get(key)
    if (!current) throw new Error('Book is not in the Reader library')

    const next = patchBookMetadata(current, patch)
    this.opened.set(key, next)
    await this.persist()
    return next
  }

  async createCollection(name: string): Promise<ReaderCollection> {
    await this.ensureLoaded()
    if (this.collections.size >= MAX_COLLECTIONS) {
      throw new Error(`Reader supports at most ${MAX_COLLECTIONS} collections`)
    }
    const clean = collectionName(name)
    this.assertUniqueCollectionName(clean)
    const now = new Date().toISOString()
    const collection = { id: randomUUID(), name: clean, createdAt: now, updatedAt: now }
    this.collections.set(collection.id, collection)
    await this.persist()
    return collection
  }

  async renameCollection(id: string, name: string): Promise<ReaderCollection> {
    await this.ensureLoaded()
    const current = this.collections.get(id)
    if (!current) throw new Error('Reader collection was not found')
    const clean = collectionName(name)
    this.assertUniqueCollectionName(clean, id)
    const next = { ...current, name: clean, updatedAt: new Date().toISOString() }
    this.collections.set(id, next)
    await this.persist()
    return next
  }

  async deleteCollection(id: string): Promise<boolean> {
    await this.ensureLoaded()
    if (!this.collections.delete(id)) return false
    for (const [key, book] of this.opened) {
      const collectionIds = (book.collectionIds ?? []).filter((value) => value !== id)
      if (collectionIds.length !== (book.collectionIds ?? []).length) {
        this.opened.set(key, { ...book, collectionIds, updatedAt: new Date().toISOString() })
      }
    }
    await this.persist()
    return true
  }

  async setCollections(
    root: string,
    sources: ReaderSource[],
    collectionIds: string[],
  ): Promise<ReaderBookSummary[]> {
    await this.ensureLoaded()
    const normalizedIds = [...new Set(collectionIds)]
    if (normalizedIds.length > MAX_COLLECTIONS_PER_BOOK) {
      throw new Error(`A book can belong to at most ${MAX_COLLECTIONS_PER_BOOK} collections`)
    }
    const missing = normalizedIds.find((id) => !this.collections.has(id))
    if (missing) throw new Error(`Reader collection was not found: ${missing}`)
    const keys = await this.sourceKeys(root, sources)
    const now = new Date().toISOString()
    const updated: ReaderBookSummary[] = []
    for (const key of keys) {
      const current = this.opened.get(key)
      if (!current) throw new Error('One or more books are not in the Reader library')
      const next = { ...current, collectionIds: normalizedIds, updatedAt: now }
      this.opened.set(key, next)
      updated.push(next)
    }
    if (updated.length > 0) await this.persist()
    return updated
  }

  async changeCollections(
    root: string,
    sources: ReaderSource[],
    addCollectionIds: string[],
    removeCollectionIds: string[],
  ): Promise<ReaderBookSummary[]> {
    await this.ensureLoaded()
    const add = [...new Set(addCollectionIds)]
    const remove = new Set(removeCollectionIds)
    const referenced = [...new Set([...add, ...remove])]
    const missing = referenced.find((id) => !this.collections.has(id))
    if (missing) throw new Error(`Reader collection was not found: ${missing}`)
    const keys = await this.sourceKeys(root, sources)
    const now = new Date().toISOString()
    const updated: ReaderBookSummary[] = []
    for (const key of keys) {
      const current = this.opened.get(key)
      if (!current) throw new Error('One or more books are not in the Reader library')
      const collectionIds = [...new Set([...(current.collectionIds ?? []), ...add])].filter(
        (id) => !remove.has(id),
      )
      if (collectionIds.length > MAX_COLLECTIONS_PER_BOOK) {
        throw new Error(`A book can belong to at most ${MAX_COLLECTIONS_PER_BOOK} collections`)
      }
      const next = { ...current, collectionIds, updatedAt: now }
      this.opened.set(key, next)
      updated.push(next)
    }
    if (updated.length > 0) await this.persist()
    return updated
  }

  async searchLibrary(
    root: string,
    query: string,
    options: Partial<Omit<ReaderSearchOptions, 'query' | 'scope' | 'chapter'>> = {},
  ): Promise<ReaderLibrarySearchResponse> {
    const { books } = await this.list()
    const limit = Math.max(1, Math.min(500, options.limit ?? 100))
    const hits: ReaderLibrarySearchResponse['hits'] = []
    let truncated = false
    for (const book of books) {
      if (hits.length >= limit) {
        truncated = true
        break
      }
      try {
        const parsed = book.mediaId
          ? await this.readMedia(book.mediaId, book.path, { remember: false })
          : await this.read(root, book.path, { remember: false })
        const result = searchReaderChapters(parsed.chapters, {
          query,
          ...DEFAULT_READER_SEARCH_OPTIONS,
          ...options,
          scope: 'book',
          limit: limit - hits.length,
        })
        for (const group of result.groups) {
          for (const match of group.matches) hits.push({ book, match })
        }
        truncated ||= result.truncated
      } catch {
        // One missing/corrupt explicit book must not sink search across the shelf.
      }
    }
    return { query: query.trim(), total: hits.length, truncated, hits }
  }

  private async rememberPath(
    path: string,
    parsed: ParsedReaderDocument,
    size: number,
    updatedAt: string,
  ): Promise<void> {
    const key = `path:${path}`
    const previous = this.opened.get(key)
    this.opened.set(key, bookFromPath(path, parsed, previous, size, updatedAt))
    await this.persist()
  }

  private async rememberMedia(
    mediaId: string,
    name: string | undefined,
    parsed: ParsedReaderDocument,
    size = 0,
  ): Promise<void> {
    const key = `media:${mediaId}`
    const previous = this.opened.get(key)
    this.opened.set(key, bookFromMedia(mediaId, name, parsed, previous, size))
    await this.persist()
  }

  /** Expire the shelf; the next read reloads after accepted writes and a previous load settle. */
  invalidateLibrary(): void {
    this.libraryStale = true
  }

  private ensureLoaded(): Promise<void> {
    if (!this.persistence) return Promise.resolve()
    if (this.libraryStale) {
      this.libraryStale = false
      const prior = this.loadPromise ?? Promise.resolve()
      this.loadPromise = Promise.all([prior, this.savePromise]).then(() => {
        this.opened.clear()
        this.collections.clear()
        return this.loadLibrary()
      })
    }
    return (this.loadPromise ??= this.loadLibrary())
  }

  private loadLibrary(): Promise<void> {
    if (!this.persistence) return Promise.resolve()
    return this.persistence.helpers
      .readJson<StoredReaderLibrary>(
        this.persistence.filePath,
        { books: [], collections: [] },
        isLibraryState,
      )
      .then((state) => {
        for (const collection of state.collections ?? []) {
          this.collections.set(collection.id, collection)
        }
        const validCollectionIds = new Set(this.collections.keys())
        for (const stored of state.books) {
          const book = bookFromStorage(stored, validCollectionIds)
          this.opened.set(book.mediaId ? `media:${book.mediaId}` : `path:${book.path}`, book)
        }
      })
  }

  private persist(): Promise<void> {
    if (!this.persistence) return Promise.resolve()
    const snapshot = {
      version: 2,
      books: [...this.opened.values()],
      collections: [...this.collections.values()],
    }
    this.savePromise = this.savePromise
      .catch(() => undefined)
      .then(() => this.persistence!.helpers.writeJson(this.persistence!.filePath, snapshot))
    return this.savePromise
  }

  private async sourceKeys(root: string, sources: ReaderSource[]): Promise<string[]> {
    const keys = await Promise.all(
      sources.map(async (source) => {
        if ('mediaId' in source) return `media:${source.mediaId}`
        const direct = `path:${source.path}`
        if (isAbsolute(source.path) && this.opened.has(direct)) return direct
        try {
          return `path:${await resolveReaderPath(root, source.path)}`
        } catch (error) {
          // A missing source must still be removable from the explicit shelf. Other
          // mutations only succeed when the direct identity is already persisted.
          if (isAbsolute(source.path)) return direct
          throw error
        }
      }),
    )
    return [...new Set(keys)]
  }

  private assertUniqueCollectionName(name: string, exceptId?: string): void {
    const needle = name.toLocaleLowerCase()
    const duplicate = [...this.collections.values()].find(
      (collection) => collection.id !== exceptId && collection.name.toLocaleLowerCase() === needle,
    )
    if (duplicate) throw new Error('A collection with this name already exists')
  }
}
