import { READER_FORMATS, type ReaderBookSummary, type ReaderCollection } from '../shared/contracts'

export interface StoredReaderLibrary {
  version?: number
  books: ReaderBookSummary[]
  collections?: ReaderCollection[]
}

export const MAX_COLLECTIONS = 200
export const MAX_COLLECTIONS_PER_BOOK = 32
export const MAX_COLLECTION_NAME_LENGTH = 80
export const MAX_METADATA_FIELD_LENGTH = 300

function isBookOverrides(value: unknown): value is NonNullable<ReaderBookSummary['overrides']> {
  if (!value || typeof value !== 'object') return false
  const overrides = value as Record<string, unknown>
  return (
    (overrides.title === undefined ||
      (typeof overrides.title === 'string' &&
        overrides.title.length > 0 &&
        overrides.title.length <= MAX_METADATA_FIELD_LENGTH)) &&
    (overrides.author === undefined ||
      (typeof overrides.author === 'string' &&
        overrides.author.length <= MAX_METADATA_FIELD_LENGTH))
  )
}

function isBookSummary(value: unknown): value is ReaderBookSummary {
  if (!value || typeof value !== 'object') return false
  const book = value as Partial<ReaderBookSummary>
  return (
    typeof book.path === 'string' &&
    (book.mediaId === undefined || typeof book.mediaId === 'string') &&
    (book.cover === undefined ||
      (typeof book.cover === 'string' && book.cover.startsWith('data:image/'))) &&
    typeof book.title === 'string' &&
    (book.author === undefined || typeof book.author === 'string') &&
    (book.sourceTitle === undefined || typeof book.sourceTitle === 'string') &&
    (book.sourceAuthor === undefined || typeof book.sourceAuthor === 'string') &&
    (book.overrides === undefined || isBookOverrides(book.overrides)) &&
    (book.collectionIds === undefined ||
      (Array.isArray(book.collectionIds) &&
        book.collectionIds.length <= MAX_COLLECTIONS_PER_BOOK &&
        book.collectionIds.every((id) => typeof id === 'string' && id.length <= 128))) &&
    typeof book.format === 'string' &&
    READER_FORMATS.includes(book.format as ReaderBookSummary['format']) &&
    typeof book.size === 'number' &&
    typeof book.updatedAt === 'string'
  )
}

function isCollection(value: unknown): value is ReaderCollection {
  if (!value || typeof value !== 'object') return false
  const collection = value as Partial<ReaderCollection>
  return (
    typeof collection.id === 'string' &&
    collection.id.length > 0 &&
    collection.id.length <= 128 &&
    typeof collection.name === 'string' &&
    collection.name.length > 0 &&
    collection.name.length <= MAX_COLLECTION_NAME_LENGTH &&
    typeof collection.createdAt === 'string' &&
    typeof collection.updatedAt === 'string'
  )
}

export function isLibraryState(value: unknown): value is StoredReaderLibrary {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<StoredReaderLibrary>
  return (
    Array.isArray(state.books) &&
    state.books.every(isBookSummary) &&
    (state.collections === undefined ||
      (Array.isArray(state.collections) &&
        state.collections.length <= MAX_COLLECTIONS &&
        state.collections.every(isCollection)))
  )
}
