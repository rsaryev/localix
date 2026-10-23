import { z } from 'zod'
import { READER_SEARCH_MODES } from '../shared/search'

export const bookQuery = z
  .object({
    path: z.string().trim().min(1).max(4096).optional(),
    mediaId: z.string().trim().min(1).max(512).optional(),
    name: z.string().trim().min(1).max(512).optional(),
  })
  .refine((value) => Boolean(value.path) !== Boolean(value.mediaId), {
    message: 'Provide either path or mediaId',
  })
export const sourceBody = bookQuery
export const chapterQuery = bookQuery.extend({ chapter: z.coerce.number().int().min(0).max(399) })
export const collectionIdParam = z.object({ id: z.string().trim().min(1).max(128) })
export const collectionBody = z.object({ name: z.string().trim().min(1).max(80) })
export const metadataBody = z
  .object({
    title: z.string().trim().min(1).max(300).nullable().optional(),
    author: z.string().trim().max(300).nullable().optional(),
  })
  .refine((value) => value.title !== undefined || value.author !== undefined, {
    message: 'Provide title or author',
  })
export const bulkLibraryBody = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('remove'),
    sources: z.array(sourceBody).min(1).max(500),
  }),
  z.object({
    action: z.literal('setCollections'),
    sources: z.array(sourceBody).min(1).max(500),
    collectionIds: z.array(z.string().trim().min(1).max(128)).max(32),
  }),
  z.object({
    action: z.literal('changeCollections'),
    sources: z.array(sourceBody).min(1).max(500),
    addCollectionIds: z.array(z.string().trim().min(1).max(128)).max(32),
    removeCollectionIds: z.array(z.string().trim().min(1).max(128)).max(32),
  }),
])
const booleanQuery = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true')
export const searchQuery = bookQuery
  .extend({
    query: z.string().trim().min(1).max(256),
    scope: z.enum(['book', 'chapter']).default('book'),
    chapter: z.coerce.number().int().min(0).max(399).optional(),
    mode: z.enum(READER_SEARCH_MODES).default('contains'),
    matchCase: booleanQuery,
    matchDiacritics: booleanQuery,
    nearbyWords: z.coerce.number().int().min(2).max(100).default(10),
    limit: z.coerce.number().int().min(1).max(500).default(200),
  })
  .refine((value) => value.scope !== 'chapter' || value.chapter !== undefined, {
    message: 'Chapter scope requires a chapter',
  })
export const librarySearchQuery = z.object({
  query: z.string().trim().min(1).max(256),
  mode: z.enum(READER_SEARCH_MODES).default('contains'),
  matchCase: booleanQuery,
  matchDiacritics: booleanQuery,
  nearbyWords: z.coerce.number().int().min(2).max(100).default(10),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})
export const readingEventBody = z.object({
  id: z.string().trim().min(1).max(128),
  source: sourceBody,
  sessionId: z.string().trim().min(1).max(128),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  chapter: z.number().int().min(0).max(100_000),
  position: z.number().int().min(1).max(1_000_000),
  totalPositions: z.number().int().min(1).max(1_000_000),
  progress: z.number().finite().min(0).max(100),
  timezoneOffset: z.number().int().min(-840).max(840),
})
