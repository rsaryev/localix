import { Hono } from 'hono'
import { z } from 'zod'
import { jsonBody, type MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'
import { documentSchema, idSchema, resumeSummary } from '../shared/schema'
import { operationsSchema } from '../shared/operations'
import { exportDocument } from '../shared/format'
import { revisionSchema } from '../shared/file-contract'
import { ResumeError, type ResumeService } from './service'

export function createResumeRoutes(resolveService: (workspace: string) => ResumeService) {
  const revision = z.string().regex(/^[a-f0-9]{64}$/u)
  const serviceFor = (c: { env: { cwd: string; sessionId?: string } }) => {
    if (!c.env.sessionId)
      throw new ResumeError(
        'invalid',
        'A live conversation is required to resolve the resume workspace',
      )
    return resolveService(c.env.cwd)
  }
  return new Hono<MiniAppRouteContext>()
    .use('*', async (c, next) => {
      c.header('Cache-Control', 'no-store')
      await next()
    })
    .onError((error, c) => {
      if (error instanceof ResumeError)
        return c.json(
          { error: error.message, code: error.code },
          error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : 400,
        )
      if (error instanceof z.ZodError)
        return c.json({ error: 'Invalid resume content', issues: error.issues }, 400)
      return c.json(
        { error: 'Cannot access resumes right now. Retry without discarding your draft.' },
        500,
      )
    })
    .get('/', async (c) =>
      c.json({ resumes: (await serviceFor(c).list(c.env.userId)).map(resumeSummary) }),
    )
    .get('/:id', async (c) =>
      c.json(await serviceFor(c).get(c.env.userId, idSchema.parse(c.req.param('id')))),
    )
    .post('/', jsonBody(z.strictObject({ document: documentSchema })), async (c) =>
      c.json(await serviceFor(c).create(c.env.userId, c.req.valid('json').document), 201),
    )
    .patch(
      '/:id',
      jsonBody(z.strictObject({ revision, operations: operationsSchema })),
      async (c) => {
        const input = c.req.valid('json')
        return c.json(
          await serviceFor(c).update(
            c.env.userId,
            idSchema.parse(c.req.param('id')),
            input.revision,
            input.operations,
          ),
        )
      },
    )
    .post(
      '/:id/duplicate',
      jsonBody(z.strictObject({ title: z.string().trim().min(1).max(500) })),
      async (c) =>
        c.json(
          await serviceFor(c).duplicate(
            c.env.userId,
            idSchema.parse(c.req.param('id')),
            c.req.valid('json').title,
          ),
          201,
        ),
    )
    .delete('/:id', jsonBody(z.strictObject({ revision })), async (c) => {
      await serviceFor(c).remove(
        c.env.userId,
        idSchema.parse(c.req.param('id')),
        c.req.valid('json').revision,
      )
      return c.json({ ok: true })
    })
    .get('/:id/history', async (c) =>
      c.json(
        (await serviceFor(c).history(c.env.userId, idSchema.parse(c.req.param('id')))).map(
          ({ document: _document, ...record }) => record,
        ),
      ),
    )
    .get('/:id/history/:revision', async (c) => {
      const target = revisionSchema.parse(c.req.param('revision'))
      const record = (
        await serviceFor(c).history(c.env.userId, idSchema.parse(c.req.param('id')))
      ).find((item) => item.revision === target)
      if (!record) throw new ResumeError('not_found', 'Saved revision not found')
      return c.json(record)
    })
    .post(
      '/:id/restore',
      jsonBody(z.strictObject({ revision, target: revisionSchema })),
      async (c) => {
        const input = c.req.valid('json')
        return c.json(
          await serviceFor(c).restore(
            c.env.userId,
            idSchema.parse(c.req.param('id')),
            input.revision,
            input.target,
          ),
        )
      },
    )
    .get('/:id/export/:format', async (c) => {
      const format = z
        .enum(['json', 'markdown', 'text', 'yaml', 'lanjut'])
        .parse(c.req.param('format'))
      const resume = await serviceFor(c).get(c.env.userId, idSchema.parse(c.req.param('id')))
      const extension = { json: 'json', markdown: 'md', text: 'txt', yaml: 'yaml', lanjut: 'json' }[
        format
      ]
      return c.body(exportDocument(resume.document, format), 200, {
        'Content-Type': `${format === 'json' ? 'application/json' : 'text/plain'}; charset=utf-8`,
        'Content-Disposition': `attachment; filename="resume-${resume.id}.${extension}"`,
      })
    })
}
