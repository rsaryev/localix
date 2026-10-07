import { classifyByAction, type PluginContext } from '@localixai/plugin-sdk/backend'
import { z } from 'zod'
import { resolve } from 'node:path'
import { templates, templateIds, createTemplateDocument } from '../shared/templates'
import { RESUME_DIR } from '../shared/file-contract'
import { documentSchema, emptyDocument, idSchema } from '../shared/schema'
import { operationsSchema } from '../shared/operations'
import { exportDocument } from '../shared/format'
import { resumeUri } from '../shared/resource-uri'
import { sectionDefinitions } from '../shared/sections'
import { ResumeError, type ResumeService } from './service'

export const toolInputSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('guide') }),
  z.strictObject({ action: z.literal('list') }),
  z.strictObject({ action: z.literal('history'), id: idSchema }),
  z.strictObject({
    action: z.literal('restore'),
    id: idSchema,
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    target: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  z.strictObject({ action: z.literal('get'), id: idSchema, sectionId: idSchema.optional() }),
  z.strictObject({
    action: z.literal('init'),
    template: z.enum(templateIds).default('awal'),
    title: z.string().trim().min(1).max(500),
    document: documentSchema.optional(),
  }),
  z.strictObject({
    action: z.literal('update'),
    id: idSchema,
    revision: z.string().regex(/^[a-f0-9]{64}$/u),
    operations: operationsSchema,
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

export function createResumeTool(ctx: PluginContext, service: ResumeService) {
  return ctx.defineTool({
    name: 'resume',
    label: 'Resume',
    activeVerb: 'Working on a resume',
    description:
      'Call guide once before authoring custom content; it specifies allowed fields per section. Initialize from a template with init, then edit structured resume files shared with the Resumes workbench. guide explains fields and edit operations. list returns identifiers and revisions; get returns authoritative structured content (optionally one section). init already returns IDs and revision, so use them directly for update without a redundant get. update applies a small atomic operation batch against the revision from init or the latest get; on conflict read again and preserve intervening edits. duplicate creates an independent variant; export returns text, Markdown, native JSON/YAML or Lanjut interchange. Use existing read/file tools for source documents and analysis. Do not invent qualifications or achievements.',
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
    async execute(_callId, input) {
      try {
        if (input.action === 'guide')
          return {
            content: JSON.stringify(
              {
                schemaVersion: 1,
                templates,
                canonicalFile: '.localix/resumes/<id>/resume.json',
                fileWorkflow:
                  'init creates the template-backed file and returns its workspace-relative path. Use ordinary read/edit tools to work on that file; get validates it and returns its current content hash. UI and tool edits share that file.',
                sections: sectionDefinitions,
                emptyDocument: emptyDocument(),
                authoring: {
                  skillsAndLanguages:
                    'Use title for the skill/language, proficiency for an optional level, or body for grouped content. Always provide bullets: []. Non-empty bullets and company context are rejected in these sections. variant belongs only to custom sections.',
                  efficientCreation:
                    'For custom content, guide then init with a valid complete document is enough. For template-first editing, init returns section/entry IDs and revision for update; no intervening get is needed.',
                },
                entry: {
                  id: 'Generate a UUID',
                  title: '',
                  organization: '',
                  location: '',
                  start: 'YYYY or YYYY-MM or empty',
                  end: 'YYYY or YYYY-MM or empty',
                  current: false,
                  body: 'Plain text or restricted rich-text JSON (see richText)',
                  bullets: ['Plain text achievement'],
                  link: null,
                  context: 'Optional company or project context',
                  proficiency: 'Optional skill or language level',
                },
                richText: {
                  document: {
                    type: 'doc',
                    content: [
                      {
                        type: 'paragraph',
                        content: [{ type: 'text', text: 'Example', marks: [{ type: 'bold' }] }],
                      },
                    ],
                  },
                  nodes: [
                    'paragraph',
                    'text',
                    'hardBreak',
                    'bulletList',
                    'orderedList',
                    'listItem',
                  ],
                  marks: [
                    'bold',
                    'italic',
                    'link (attrs.href: absolute HTTP, HTTPS, mailto or tel URL)',
                  ],
                  lists:
                    'List content is listItem nodes; each item begins with a paragraph. Ordered lists may set attrs.start.',
                  limits:
                    '8,000 description characters; 1,000 nodes and 12 levels per rich document. No HTML, images, headings, colors or arbitrary attributes.',
                },
                operations: [
                  'header: merge value',
                  'metadata: merge title/targetRole/jobDescription',
                  'presentation: replace value preserving existing fields; template, font, language, showIcons, sectionSpacing, letterSpacing, lineHeight, nameScale, titleScale, bodyScale, photoSize, photoRadius, photoAlign',
                  'addSection: section {id,type,title,hidden,entries}',
                  'updateSection: sectionId, value {title?,hidden?,columns?,showProficiency?,variant?}',
                  'removeSection: sectionId',
                  'moveSection: sectionId, index (zero-based)',
                  'addEntry: sectionId, entry',
                  'updateEntry: sectionId, entryId, value (only changed fields)',
                  'removeEntry: sectionId, entryId',
                  'moveEntry: sectionId, entryId, index',
                ],
                limits:
                  '100 resumes per user; 24 sections; 60 entries per section; 30 bullets per entry; 50 operations per batch; 100,000 serialized characters excluding portrait; portrait up to 300,000 characters.',
                workflow:
                  'Read source files using existing tools. Ask for missing facts. Create or duplicate, get current ids/revision, update only intended fields. Hidden sections stay in JSON and get but are omitted from visible exports. Target role/job description are context only, never exported as resume prose. The UI exports template-aware PDF/DOCX via Documents. Markdown generation is linear; no ATS acceptance guarantee.',
              },
              null,
              2,
            ),
          }
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
        if (input.action === 'restore') {
          const resume = await service.restore(
            ctx.userId,
            input.id,
            input.revision,
            input.target,
            'agent',
          )
          return { content: JSON.stringify({ ...resume, path: service.path(resume.id) }) }
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
        const resume =
          input.action === 'init'
            ? await service.create(
                ctx.userId,
                {
                  ...(input.document ?? createTemplateDocument(input.template, input.title)),
                  title: input.title,
                },
                undefined,
                'agent',
              )
            : input.action === 'duplicate'
              ? await service.duplicate(ctx.userId, input.id, input.title, 'agent')
              : await service.update(
                  ctx.userId,
                  input.id,
                  input.revision,
                  input.operations,
                  'agent',
                )
        return {
          content: JSON.stringify({ ...resume, path: service.path(resume.id) }),
          details: ctx.ui.open({ uri: resumeUri(resume.id), label: resume.document.title }),
        }
      } catch (error) {
        return {
          content:
            error instanceof ResumeError
              ? `${error.code}: ${error.message}`
              : error instanceof z.ZodError
                ? `Invalid resume: ${JSON.stringify(error.issues)}`
                : 'Resume operation failed. Read the current resume and retry; do not discard unrelated content.',
          isError: true,
        }
      }
    },
  })
}
