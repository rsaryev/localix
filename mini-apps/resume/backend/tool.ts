import { classifyByAction, type MiniAppContext } from '@localixai/mini-app-sdk/backend'
import { z } from 'zod'
import { resolve } from 'node:path'
import { templateIds } from '../shared/templates'
import { RESUME_DIR } from '../shared/file-contract'
import { idSchema } from '../shared/schema'
import { exportDocument } from '../shared/format'
import { resumeUri } from '../shared/resource-uri'
import { contentInputSchema, documentFromContent } from './authoring'
import { authoringOperationsSchema, resolveOperations } from './authoring-ops'
import { resumeGuide, resumeOutline } from './tool-guide'
import { ResumeError, type ResumeService } from './service'

const revision = z.string().regex(/^[a-f0-9]{64}$/u)

export const toolInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('guide') }),
  z.strictObject({ action: z.literal('list') }),
  z.strictObject({ action: z.literal('history'), id: idSchema }),
  z.strictObject({ action: z.literal('restore'), id: idSchema, revision, target: revision }),
  z.strictObject({ action: z.literal('get'), id: idSchema, sectionId: idSchema.optional() }),
  z.strictObject({
    action: z.literal('init'),
    title: z.string().trim().min(1).max(500),
    template: z.enum(templateIds).optional(),
    document: contentInputSchema
      .optional()
      .describe('The whole resume in one call; omit for the empty template'),
  }),
  z.strictObject({
    action: z.literal('update'),
    id: idSchema,
    revision: revision
      .optional()
      .describe('From your last init/get/update; guards against overwriting'),
    operations: authoringOperationsSchema,
  }),
  z.strictObject({
    action: z.literal('duplicate'),
    id: idSchema,
    title: z.string().trim().min(1).max(500),
  }),
  z.strictObject({
    action: z.literal('export'),
    id: idSchema,
    format: z.enum(['json', 'markdown', 'text', 'yaml', 'lanjut']),
  }),
])
type ToolInput = z.infer<typeof toolInputSchema>

/** One line per problem, addressed the way the author wrote the call. */
function describeIssues(error: z.ZodError) {
  return error.issues
    .slice(0, 12)
    .map((issue) => {
      const path = issue.path
        .map((part, index) =>
          typeof part === 'number' ? `[${part}]` : index ? `.${String(part)}` : String(part),
        )
        .join('')
      return `- ${path || 'input'}: ${issue.message}`
    })
    .join('\n')
}

export function createResumeTool(ctx: MiniAppContext, service: ResumeService) {
  return ctx.defineTool({
    name: 'resume',
    label: 'Resume',
    activeVerb: 'Working on a resume',
    description:
      'Create and edit structured resumes shared with the Resumes workbench. init {title, template?, document?} creates one; pass the whole content as document in that same call: {targetRole?, header: {name, headline, email, phone, location, links}, sections: [{type, entries: [{title, organization, location, start, end, body, bullets}]}]}. Write only fields with content; ids and empty fields are filled in. Section types: summary (one entry, body only), experience, internship, projects, organizations, education, certifications, skills/languages (title + comma-separated body, no bullets), custom. Dates YYYY or YYYY-MM; end "present" for ongoing. update {id, revision, operations} applies 1–50 operations; addEntry accepts a section type as sectionId. Results return ids, revision and notes about anything adjusted. guide lists fields per section and every operation; list, get (full content), history, restore, duplicate and export (text, markdown, json, yaml, lanjut) cover the rest. Do not invent qualifications for a real person.',
    inputSchema: toolInputSchema,
    executionMode: 'sequential',
    mutates: true,
    permissionPaths: (input) => {
      const parsed = toolInputSchema.safeParse(input)
      return parsed.success &&
        ['init', 'update', 'duplicate', 'restore'].includes(parsed.data.action)
        ? [resolve(ctx.cwd, RESUME_DIR)]
        : []
    },
    classify: classifyByAction({
      guide: { effect: 'read' },
      history: { effect: 'read' },
      restore: { effect: 'files' },
      list: { effect: 'read' },
      get: { effect: 'read' },
      export: { effect: 'read' },
      init: { effect: 'files' },
      update: { effect: 'files' },
      duplicate: { effect: 'files' },
    }),
    async execute(_callId, raw) {
      // The runtime checks the JSON schema only; zod runs here so optional fields and
      // refinements mean the same thing on both sides.
      let input: ToolInput
      try {
        input = toolInputSchema.parse(raw)
      } catch (error) {
        return {
          content: `Invalid resume call:\n${describeIssues(error as z.ZodError)}`,
          isError: true,
        }
      }
      try {
        if (input.action === 'guide') return { content: JSON.stringify(resumeGuide()) }
        if (input.action === 'list')
          return {
            content: JSON.stringify(
              (await service.list(ctx.userId)).map((item) => ({
                id: item.id,
                title: item.document.title,
                targetRole: item.document.targetRole,
                revision: item.revision,
                uri: resumeUri(item.id),
              })),
            ),
          }
        if (input.action === 'history')
          return {
            content: JSON.stringify(
              (await service.history(ctx.userId, input.id)).map(
                ({ document: _document, ...record }) => record,
              ),
            ),
          }
        if (input.action === 'get') {
          const resume = await service.get(ctx.userId, input.id)
          const section = input.sectionId
            ? resume.document.sections.find((item) => item.id === input.sectionId)
            : undefined
          if (input.sectionId && !section) throw new ResumeError('not_found', 'Section not found')
          const uri = resumeUri(resume.id, input.sectionId)
          return {
            content: JSON.stringify(
              section
                ? {
                    path: service.path(resume.id),
                    id: resume.id,
                    revision: resume.revision,
                    section,
                  }
                : { ...resume, path: service.path(resume.id) },
            ),
            sources: [
              {
                id: uri,
                kind: 'resource',
                uri,
                title: section?.title ?? resume.document.title,
                role: 'consulted',
                status: 'available',
              },
            ],
          }
        }
        if (input.action === 'export') {
          const resume = await service.get(ctx.userId, input.id)
          return { content: exportDocument(resume.document, input.format) }
        }
        const notes: string[] = []
        const resume = await mutate(input, notes)
        return {
          content: JSON.stringify(resumeOutline(resume, service.path(resume.id), notes)),
          details: ctx.ui.offer({ uri: resumeUri(resume.id), label: resume.document.title }),
        }
      } catch (error) {
        return {
          content:
            error instanceof ResumeError
              ? `${error.code}: ${error.message}`
              : error instanceof z.ZodError
                ? `Invalid resume:\n${describeIssues(error)}\nNothing was saved; fix these fields and resend the call.`
                : error instanceof Error
                  ? `${error.message}. Nothing was saved.`
                  : 'Resume operation failed. Read the current resume and retry; do not discard unrelated content.',
          isError: true,
        }
      }
    },
  })

  async function mutate(
    input: Extract<ToolInput, { action: 'init' | 'update' | 'duplicate' | 'restore' }>,
    notes: string[],
  ) {
    if (input.action === 'init')
      return service.create(
        ctx.userId,
        documentFromContent(input.title, input.template ?? 'awal', input.document, notes),
        undefined,
        'agent',
      )
    if (input.action === 'duplicate')
      return service.duplicate(ctx.userId, input.id, input.title, 'agent')
    if (input.action === 'restore')
      return service.restore(ctx.userId, input.id, input.revision, input.target, 'agent')
    const current = await service.get(ctx.userId, input.id)
    const operations = resolveOperations(current.document, input.operations, notes)
    // Operations address content by id, so applying them to the latest file is safe; a stated
    // revision still refuses a stale one.
    return service.update(
      ctx.userId,
      input.id,
      input.revision ?? current.revision,
      operations,
      'agent',
    )
  }
}
