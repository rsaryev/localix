import { z } from 'zod'
import { richTextSchema, richTextToText } from '@localixai/plugin-sdk/rich-text'
import { sectionDefinitions } from './sections'

export const sectionTypes = [
  'summary',
  'experience',
  'internship',
  'projects',
  'organizations',
  'education',
  'certifications',
  'skills',
  'languages',
  'custom',
] as const
export const idSchema = z.string().uuid()
const short = z
  .string()
  .max(500)
  .refine(
    (value) => !/[\r\n]/u.test(value) && !value.includes(String.fromCharCode(0)),
    'Use a single line',
  )
const prose = z.string().max(8_000)
const richProse = z
  .union([prose, richTextSchema])
  .refine((value) => richTextToText(value).length <= 8_000, 'Description exceeds 8,000 characters')
export const linkSchema = z.strictObject({
  label: short,
  url: z
    .url()
    .max(2_000)
    .refine((url) => {
      try {
        return ['http:', 'https:'].includes(new URL(url).protocol)
      } catch {
        return false
      }
    }, 'Use an HTTP or HTTPS link'),
})
export const headerSchema = z.strictObject({
  name: short,
  headline: short,
  email: short,
  phone: short,
  location: short,
  links: z.array(linkSchema).max(12),
})
const date = z.string().regex(/^(?:|\d{4}(?:-(?:0[1-9]|1[0-2]))?)$/, 'Use YYYY or YYYY-MM')
export const entryFieldsSchema = z.strictObject({
  id: idSchema,
  title: short,
  organization: short,
  location: short,
  start: date,
  end: date,
  current: z.boolean(),
  body: richProse,
  bullets: z.array(z.string().trim().min(1).max(2_000)).max(30),
  link: linkSchema.nullable(),
})
export const entrySchema = entryFieldsSchema.superRefine((entry, ctx) => {
  if (entry.current && entry.end)
    ctx.addIssue({
      code: 'custom',
      message: 'A current entry cannot have an end date',
      path: ['end'],
    })
  if (entry.start && entry.end && entry.end < entry.start.slice(0, entry.end.length))
    ctx.addIssue({ code: 'custom', message: 'End date precedes start date', path: ['end'] })
})
export const sectionSchema = z.strictObject({
  id: idSchema,
  type: z.enum(sectionTypes),
  title: short.trim().min(1),
  hidden: z.boolean(),
  entries: z.array(entrySchema).max(60),
})
export const presentationSchema = z.strictObject({
  template: z.enum(['awal', 'ketat', 'luasa', 'tebal', 'klasik', 'ketik']),
})
export const documentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    title: short.trim().min(1),
    targetRole: short,
    jobDescription: z.string().max(16_000),
    header: headerSchema,
    sections: z.array(sectionSchema).max(24),
    presentation: presentationSchema,
  })
  .superRefine((doc, ctx) => {
    const ids = new Set<string>()
    doc.sections.forEach((section, sectionIndex) => {
      const fields = sectionDefinitions[section.type].fields
      if (section.type === 'summary' && section.entries.length > 1)
        ctx.addIssue({
          code: 'custom',
          message: 'Summary contains one entry',
          path: ['sections', sectionIndex, 'entries'],
        })
      section.entries.forEach((entry, entryIndex) => {
        for (const key of [
          'title',
          'organization',
          'location',
          'start',
          'end',
          'body',
          'bullets',
        ] as const)
          if (
            !fields.includes(key) &&
            (key === 'body' ? richTextToText(entry.body).length : entry[key].length) > 0
          )
            ctx.addIssue({
              code: 'custom',
              message: `This field is not part of a ${section.type} entry`,
              path: ['sections', sectionIndex, 'entries', entryIndex, key],
            })
        if (!fields.includes('end') && entry.current)
          ctx.addIssue({
            code: 'custom',
            message: 'Ongoing status requires a dated entry',
            path: ['sections', sectionIndex, 'entries', entryIndex, 'current'],
          })
        if (['summary', 'skills', 'languages'].includes(section.type) && entry.link)
          ctx.addIssue({
            code: 'custom',
            message: 'Use a reference link on a project, experience or education entry',
            path: ['sections', sectionIndex, 'entries', entryIndex, 'link'],
          })
      })
    })
    for (const item of doc.sections.flatMap((section) => [section, ...section.entries])) {
      if (ids.has(item.id))
        ctx.addIssue({ code: 'custom', message: `Duplicate identifier: ${item.id}` })
      ids.add(item.id)
    }
    if (JSON.stringify(doc).length > 100_000)
      ctx.addIssue({ code: 'custom', message: 'Resume exceeds the 100,000 character limit' })
  })
export const resumeSchema = z.strictObject({
  id: idSchema,
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  sourceId: idSchema.optional(),
  document: documentSchema,
})
export type ResumeDocument = z.infer<typeof documentSchema>
export type Resume = z.infer<typeof resumeSchema>
export type ResumeEntry = z.infer<typeof entrySchema>
export type ResumeSection = z.infer<typeof sectionSchema>
export type SectionType = (typeof sectionTypes)[number]

export function emptyEntry(): ResumeEntry {
  return {
    id: crypto.randomUUID(),
    title: '',
    organization: '',
    location: '',
    start: '',
    end: '',
    current: false,
    body: '',
    bullets: [],
    link: null,
  }
}
export function emptyDocument(title = 'Untitled resume'): ResumeDocument {
  return {
    schemaVersion: 1,
    title,
    targetRole: '',
    jobDescription: '',
    header: { name: '', headline: '', email: '', phone: '', location: '', links: [] },
    sections: [],
    presentation: { template: 'awal' },
  }
}

export const resumeSummarySchema = z.strictObject({
  id: idSchema,
  title: short,
  targetRole: short,
  revision: z.string().regex(/^[a-f0-9]{64}$/u),
  updatedAt: z.iso.datetime(),
})
export type ResumeSummary = z.infer<typeof resumeSummarySchema>
export function resumeSummary(resume: Resume): ResumeSummary {
  return {
    id: resume.id,
    title: resume.document.title,
    targetRole: resume.document.targetRole,
    revision: resume.revision,
    updatedAt: resume.updatedAt,
  }
}
