import { Hono } from 'hono'
import { routeValidator, type PluginRouteContext } from '@localixai/plugin-sdk/backend'
import { z } from 'zod'

import type { ReaderService } from './service'
import { ReaderStatsService } from './stats'
import { searchReaderChapters, READER_SEARCH_MODES } from '../shared/search'

const bookQuery = z
  .object({
    path: z.string().trim().min(1).max(4096).optional(),
    mediaId: z.string().trim().min(1).max(512).optional(),
    name: z.string().trim().min(1).max(512).optional(),
  })
  .refine((value) => Boolean(value.path) !== Boolean(value.mediaId), {
    message: 'Provide either path or mediaId',
  })
const sourceBody = z
  .object({
    path: z.string().trim().min(1).max(4096).optional(),
    mediaId: z.string().trim().min(1).max(512).optional(),
    name: z.string().trim().min(1).max(512).optional(),
  })
  .refine((value) => Boolean(value.path) !== Boolean(value.mediaId), {
    message: 'Provide either path or mediaId',
  })
const chapterQuery = bookQuery.extend({ chapter: z.coerce.number().int().min(0).max(399) })
const collectionIdParam = z.object({ id: z.string().trim().min(1).max(128) })
const collectionBody = z.object({ name: z.string().trim().min(1).max(80) })
const metadataBody = z
  .object({
    title: z.string().trim().min(1).max(300).nullable().optional(),
    author: z.string().trim().max(300).nullable().optional(),
  })
  .refine((value) => value.title !== undefined || value.author !== undefined, {
    message: 'Provide title or author',
  })
const bulkLibraryBody = z.discriminatedUnion('action', [
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
const searchQuery = bookQuery
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
const librarySearchQuery = z.object({
  query: z.string().trim().min(1).max(256),
  mode: z.enum(READER_SEARCH_MODES).default('contains'),
  matchCase: booleanQuery,
  matchDiacritics: booleanQuery,
  nearbyWords: z.coerce.number().int().min(2).max(100).default(10),
  limit: z.coerce.number().int().min(1).max(500).default(100),
})
const readingEventBody = z.object({
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

function readSource(
  service: ReaderService,
  root: string,
  query: z.infer<typeof bookQuery>,
  remember: boolean,
) {
  return query.mediaId
    ? service.readMedia(query.mediaId, query.name, { remember })
    : service.read(root, query.path!, { remember })
}

function querySource(query: z.infer<typeof bookQuery>) {
  return query.mediaId
    ? ({ mediaId: query.mediaId, ...(query.name ? { name: query.name } : {}) } as const)
    : ({ path: query.path! } as const)
}

async function explicitSource(
  service: ReaderService,
  root: string,
  source: z.infer<typeof sourceBody>,
) {
  const canonical = await service.librarySource(root, querySource(source))
  if (!canonical) throw new Error('Book is not in the Reader library')
  return canonical
}

/** The SDK's validator in its `text` envelope — the Reader client reads `error` as the sentence. */
const validated = routeValidator({ envelope: 'text' })

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The sentence, and the raw text under it.
 *
 * What this service throws is written to be read. What the parsers it calls throw is not: pdf.js,
 * fflate and the mobi decoder answer in their own words, and echoing those as the whole failure put
 * `InvalidPDFException: Invalid PDF structure.` across the reading pane. A wrapped throw keeps that
 * text as its `cause`; `detail` is where it goes, because the Event Center has room for it.
 */
function failure(error: unknown): { error: string; detail?: string } {
  const said = message(error)
  const raw = error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
  return { error: said, ...(raw && raw !== said ? { detail: raw } : {}) }
}

function status(error: unknown): 400 | 404 | 413 | 500 {
  const value = message(error)
  if (value.includes('larger than') || value.includes('beyond the limit')) return 413
  if (
    value.includes('ENOENT') ||
    value.includes('not a file') ||
    value.includes('not found') ||
    value.includes('not in the Reader library')
  )
    return 404
  if (
    value.includes('path') ||
    value.includes('EPUB') ||
    value.includes('Unsupported') ||
    value.includes('Collection') ||
    value.includes('collection') ||
    value.includes('Title') ||
    value.includes('Author') ||
    value.includes('Search') ||
    value.includes('search') ||
    value.includes('Regular expression')
  )
    return 400
  return 500
}

export function createReaderRoutes(
  service: ReaderService,
  statsService: ReaderStatsService = new ReaderStatsService(),
) {
  return new Hono<PluginRouteContext>()
    .get('/library', async (context) => {
      try {
        return context.json(await service.list())
      } catch (error) {
        return context.json(failure(error), 500)
      }
    })
    .delete('/library', validated('query', bookQuery), async (context) => {
      try {
        const removed = await service.remove(
          context.env.cwd,
          querySource(context.req.valid('query')),
        )
        return context.json({ removed })
      } catch (error) {
        return context.json(failure(error), status(error))
      }
    })
    .patch(
      '/library/book',
      validated('query', bookQuery),
      validated('json', metadataBody),
      async (context) => {
        try {
          const book = await service.updateMetadata(
            context.env.cwd,
            querySource(context.req.valid('query')),
            context.req.valid('json'),
          )
          return context.json({ book })
        } catch (error) {
          return context.json(failure(error), status(error))
        }
      },
    )
    .post('/library/bulk', validated('json', bulkLibraryBody), async (context) => {
      try {
        const body = context.req.valid('json')
        const sources = body.sources.map(querySource)
        if (body.action === 'remove') {
          return context.json({ removed: await service.removeMany(context.env.cwd, sources) })
        }
        const books =
          body.action === 'setCollections'
            ? await service.setCollections(context.env.cwd, sources, body.collectionIds)
            : await service.changeCollections(
                context.env.cwd,
                sources,
                body.addCollectionIds,
                body.removeCollectionIds,
              )
        return context.json({ books })
      } catch (error) {
        return context.json(failure(error), status(error))
      }
    })
    .post('/library/collections', validated('json', collectionBody), async (context) => {
      try {
        return context.json(
          { collection: await service.createCollection(context.req.valid('json').name) },
          201,
        )
      } catch (error) {
        return context.json(failure(error), status(error))
      }
    })
    .patch(
      '/library/collections/:id',
      validated('param', collectionIdParam),
      validated('json', collectionBody),
      async (context) => {
        try {
          return context.json({
            collection: await service.renameCollection(
              context.req.valid('param').id,
              context.req.valid('json').name,
            ),
          })
        } catch (error) {
          return context.json(failure(error), status(error))
        }
      },
    )
    .delete('/library/collections/:id', validated('param', collectionIdParam), async (context) => {
      try {
        return context.json({
          removed: await service.deleteCollection(context.req.valid('param').id),
        })
      } catch (error) {
        return context.json(failure(error), status(error))
      }
    })
    .get('/library/search', validated('query', librarySearchQuery), async (context) => {
      try {
        const query = context.req.valid('query')
        return context.json(
          await service.searchLibrary(context.env.cwd, query.query, {
            mode: query.mode,
            matchCase: query.matchCase,
            matchDiacritics: query.matchDiacritics,
            nearbyWords: query.nearbyWords,
            limit: query.limit,
          }),
        )
      } catch (error) {
        return context.json(failure(error), status(error))
      }
    })
    .get('/stats', validated('query', bookQuery), async (context) => {
      try {
        const query = context.req.valid('query')
        const source = await explicitSource(service, context.env.cwd, query)
        return context.json(await statsService.get(source))
      } catch (error) {
        return context.json(failure(error), status(error))
      }
    })
    .post('/stats/events', validated('json', readingEventBody), async (context) => {
      try {
        const input = context.req.valid('json')
        const source = await explicitSource(service, context.env.cwd, input.source)
        return context.json({
          recorded: await statsService.record({ ...input, source }),
        })
      } catch (error) {
        return context.json(failure(error), status(error))
      }
    })
    .get('/document', validated('query', bookQuery), async (context) => {
      try {
        const parsed = await readSource(service, context.env.cwd, context.req.valid('query'), true)
        return context.json({ document: parsed.document })
      } catch (error) {
        return context.json(failure(error), status(error))
      }
    })
    .get('/chapter', validated('query', chapterQuery), async (context) => {
      try {
        const query = context.req.valid('query')
        const parsed = await readSource(service, context.env.cwd, query, false)
        const chapter = parsed.chapters[query.chapter]
        return chapter
          ? context.json({ document: parsed.document, chapter })
          : context.json({ error: 'Chapter not found' }, 404)
      } catch (error) {
        return context.json(failure(error), status(error))
      }
    })
    .get('/search', validated('query', searchQuery), async (context) => {
      try {
        const query = context.req.valid('query')
        const parsed = await readSource(service, context.env.cwd, query, false)
        return context.json(
          searchReaderChapters(parsed.chapters, {
            query: query.query,
            scope: query.scope,
            ...(query.chapter === undefined ? {} : { chapter: query.chapter }),
            mode: query.mode,
            matchCase: query.matchCase,
            matchDiacritics: query.matchDiacritics,
            nearbyWords: query.nearbyWords,
            limit: query.limit,
          }),
        )
      } catch (error) {
        return context.json(failure(error), status(error))
      }
    })
}
