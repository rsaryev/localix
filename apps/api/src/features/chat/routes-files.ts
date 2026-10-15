import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import type { AppContext } from '../../app'
import { sessionParamsSchema } from './contracts'
import {
  contentSearchQuerySchema,
  fileCreateRequestSchema,
  fileDeleteRequestSchema,
  filePasteRequestSchema,
  filePathRequestSchema,
  fileReadQuerySchema,
  fileRenameRequestSchema,
  fileSearchQuerySchema,
  fileWriteRequestSchema,
  replaceContentRequestSchema,
  treeQuerySchema,
} from './routes-schemas'
import type { ChatRoutesService } from './routes-types'

/** The session workspace file browser: read/write, tree, entry ops, search/replace. */
export function createChatFilesRoutes(service: ChatRoutesService) {
  return new Hono<AppContext>()
    .get(
      '/sessions/:id/file',
      zValidator('param', sessionParamsSchema),
      zValidator('query', fileReadQuerySchema),
      async (c) => {
        const q = c.req.valid('query')
        return c.json(
          await service.readFile(c.get('userId'), c.req.valid('param').id, q.path, {
            full: q.full !== undefined,
            knownHash: q.knownHash,
            signal: c.req.raw.signal,
          }),
          200,
        )
      },
    )
    .put(
      '/sessions/:id/file',
      zValidator('param', sessionParamsSchema),
      zValidator('json', fileWriteRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.writeFile(
            c.get('userId'),
            c.req.valid('param').id,
            body.path,
            body.content,
            body.baseHash,
          ),
          200,
        )
      },
    )
    .get(
      '/sessions/:id/tree',
      zValidator('param', sessionParamsSchema),
      zValidator('query', treeQuerySchema),
      async (c) => {
        return c.json(
          await service.listDirectory(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('query').path,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/file-create',
      zValidator('param', sessionParamsSchema),
      zValidator('json', fileCreateRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.createFileEntry(
            c.get('userId'),
            c.req.valid('param').id,
            body.parentPath,
            body.name,
            body.kind,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/file-rename',
      zValidator('param', sessionParamsSchema),
      zValidator('json', fileRenameRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.renameFileEntry(
            c.get('userId'),
            c.req.valid('param').id,
            body.path,
            body.newName,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/file-paste',
      zValidator('param', sessionParamsSchema),
      zValidator('json', filePasteRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.pasteFileEntry(
            c.get('userId'),
            c.req.valid('param').id,
            body.source,
            body.destDir,
            body.mode,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/file-delete',
      zValidator('param', sessionParamsSchema),
      zValidator('json', fileDeleteRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.deleteFileEntry(c.get('userId'), c.req.valid('param').id, body.path, {
            permanent: body.permanent,
          }),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/file-duplicate',
      zValidator('param', sessionParamsSchema),
      zValidator('json', filePathRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.duplicateFileEntry(c.get('userId'), c.req.valid('param').id, body.path),
          200,
        )
      },
    )
    .post('/sessions/:id/file-undo', zValidator('param', sessionParamsSchema), async (c) => {
      return c.json(await service.undoFileOp(c.get('userId'), c.req.valid('param').id), 200)
    })
    .post(
      '/sessions/:id/file-reveal',
      zValidator('param', sessionParamsSchema),
      zValidator('json', filePathRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.revealFileEntry(c.get('userId'), c.req.valid('param').id, body.path),
          200,
        )
      },
    )
    .get(
      '/sessions/:id/files',
      zValidator('param', sessionParamsSchema),
      zValidator('query', fileSearchQuerySchema),
      async (c) => {
        const { q, limit, offset, mode, type, ext, includeIgnored } = c.req.valid('query')
        return c.json(
          await service.findFiles(c.get('userId'), c.req.valid('param').id, q ?? '', {
            limit,
            offset,
            mode,
            type,
            extensions: ext
              ? ext
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              : undefined,
            includeIgnored,
          }),
          200,
        )
      },
    )
    .get(
      '/sessions/:id/search-content',
      zValidator('param', sessionParamsSchema),
      zValidator('query', contentSearchQuerySchema),
      async (c) => {
        const {
          q,
          limit,
          regex,
          caseSensitive,
          wholeWord,
          glob,
          excludeGlob,
          contextLines,
          includeIgnored,
        } = c.req.valid('query')
        return c.json(
          await service.searchContent(c.get('userId'), c.req.valid('param').id, q ?? '', {
            limit,
            regex,
            caseSensitive,
            wholeWord,
            glob,
            excludeGlob,
            contextLines,
            includeIgnored,
          }),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/replace-content',
      zValidator('param', sessionParamsSchema),
      zValidator('json', replaceContentRequestSchema),
      async (c) => {
        const {
          q,
          replacement,
          regex,
          caseSensitive,
          wholeWord,
          glob,
          excludeGlob,
          includeIgnored,
        } = c.req.valid('json')
        return c.json(
          await service.replaceContent(c.get('userId'), c.req.valid('param').id, q, replacement, {
            regex,
            caseSensitive,
            wholeWord,
            glob,
            excludeGlob,
            includeIgnored,
          }),
          200,
        )
      },
    )
}
