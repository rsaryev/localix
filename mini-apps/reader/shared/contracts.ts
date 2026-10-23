export const READER_PROVIDER = 'reader'

export const READER_FORMATS = [
  'epub',
  'pdf',
  'mobi',
  'azw3',
  'fb2',
  'cbz',
  'md',
  'txt',
  'html',
] as const
export type ReaderFormat = (typeof READER_FORMATS)[number]
export type ReaderChapterContentKind = 'html' | 'markdown' | 'text'

export type ReaderSource = { path: string } | { mediaId: string; name?: string }

export interface ReaderBookSummary {
  path: string
  mediaId?: string
  cover?: string
  /** Effective display title after an optional user override. */
  title: string
  /** Effective display author after an optional user override. */
  author?: string
  /** Parsed source metadata retained so an edit can be reset without reopening the file. */
  sourceTitle?: string
  sourceAuthor?: string
  /** User-owned metadata fields; kept separate from parsed source metadata. */
  overrides?: {
    title?: string
    author?: string
  }
  /** A book may live on more than one shelf without duplicating the library entry. */
  collectionIds?: string[]
  format: ReaderFormat
  size: number
  updatedAt: string
}

export interface ReaderCollection {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

export interface ReaderBookMetadataPatch {
  /** `null` clears the user override and restores the parsed value. */
  title?: string | null
  /** `null` clears the user override and restores the parsed value. */
  author?: string | null
}

export interface ReaderChapterSummary {
  id: string
  index: number
  title: string
  wordCount: number
}

export interface ReaderDocument {
  path: string
  title: string
  author?: string
  language?: string
  format: ReaderFormat
  wordCount: number
  chapters: ReaderChapterSummary[]
}

export interface ReaderChapter extends ReaderChapterSummary {
  kind: ReaderChapterContentKind
  content: string
  text: string
}

export interface ReaderReadingEventInput {
  id: string
  source: ReaderSource
  sessionId: string
  startedAt: string
  endedAt: string
  chapter: number
  position: number
  totalPositions: number
  progress: number
  timezoneOffset: number
}

export interface ReaderDailyStat {
  date: string
  readMs: number
}

export interface ReaderBookStats {
  readMs: number
  sessionCount: number
  positionsRead: number
  activeDays: number
  currentStreakDays: number
  longestStreakDays: number
  averageSessionMs: number
  startedAt?: string
  lastReadAt?: string
  progress: number
  daily: ReaderDailyStat[]
}

export interface ReaderStatsResponse {
  book: ReaderBookStats
  library: ReaderBookStats
}

export interface ReaderLibraryResponse {
  books: ReaderBookSummary[]
  collections: ReaderCollection[]
}

export interface ReaderDocumentResponse {
  document: ReaderDocument
}

export interface ReaderChapterResponse {
  document: ReaderDocument
  chapter: ReaderChapter
}

export type {
  ReaderLibrarySearchResponse,
  ReaderSearchMatch,
  ReaderSearchOptions,
  ReaderSearchResponse,
} from './search'
