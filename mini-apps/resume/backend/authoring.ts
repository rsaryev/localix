import { z } from 'zod'
import { richTextToText } from '@localixai/mini-app-sdk/rich-text'
import {
  emptyDocument,
  idSchema,
  presentationSchema,
  richProse,
  sectionTypes,
  type ResumeDocument,
  type ResumeEntry,
  type ResumeSection,
  type SectionType,
} from '../shared/schema'
import { sectionDefinitions, type EntryField } from '../shared/sections'
import { createTemplateDocument, type TemplateId } from '../shared/templates'

/*
 * The agent-facing shapes. The stored document is strict — every entry carries every field, a
 * UUID and `link: null` — and asking a model to reproduce that wall of empty strings is where
 * creation failed: one missing `link` refused a whole resume. Authors write only what has content;
 * normalization fills the rest, folds near-misses into their place and reports what it changed.
 * The stored contract (`documentSchema`) still validates the result.
 */
const text = z.string()
const linkInput = z.union([
  z.string().describe('URL'),
  z.strictObject({ label: text.optional(), url: z.string() }),
])
export const entryInputSchema = z.strictObject({
  id: idSchema.optional(),
  title: text.optional(),
  organization: text.optional(),
  location: text.optional(),
  start: text.optional().describe('YYYY or YYYY-MM'),
  end: text.optional().describe('YYYY or YYYY-MM; "present" marks an ongoing entry'),
  current: z.boolean().optional(),
  body: richProse.optional(),
  bullets: z.array(text).optional(),
  link: linkInput.nullable().optional(),
  context: text.optional(),
  proficiency: text.optional(),
})
export const sectionInputSchema = z.strictObject({
  id: idSchema.optional(),
  type: z.enum(sectionTypes),
  title: text.optional(),
  hidden: z.boolean().optional(),
  entries: z.array(entryInputSchema).max(60).optional(),
  columns: z.union([z.literal(1), z.literal(2)]).optional(),
  showProficiency: z.boolean().optional(),
  variant: z.enum(['rich', 'list']).optional(),
})
export const headerInputSchema = z.strictObject({
  name: text.optional(),
  headline: text.optional(),
  email: text.optional(),
  phone: text.optional(),
  location: text.optional(),
  links: z.array(linkInput).max(12).optional(),
})
export const contentInputSchema = z.strictObject({
  schemaVersion: z.literal(1).optional(),
  title: text.optional(),
  targetRole: text.optional(),
  jobDescription: text.optional(),
  header: headerInputSchema.optional(),
  sections: z.array(sectionInputSchema).max(24).optional(),
  presentation: presentationSchema.partial().optional(),
})
export type EntryInput = z.infer<typeof entryInputSchema>
export type SectionInput = z.infer<typeof sectionInputSchema>
export type HeaderInput = z.infer<typeof headerInputSchema>
export type ContentInput = z.infer<typeof contentInputSchema>

// Russian résumés say "ongoing" too ("present time", "to the present time"): escaped, sources are English.
const ONGOING =
  /^(?:present|current|now|ongoing|today|\u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0435 \u0432\u0440\u0435\u043c\u044f|\u043f\u043e \u043d\u0430\u0441\u0442\u043e\u044f\u0449\u0435\u0435 \u0432\u0440\u0435\u043c\u044f)$/iu
const SCALARS = ['title', 'organization', 'location', 'start', 'end'] as const

function date(value: string | undefined) {
  const trimmed = value?.trim() ?? ''
  const match = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/u.exec(trimmed)
  return match ? `${match[1]}-${match[2]!.padStart(2, '0')}` : trimmed
}

export function normalizeLink(input: z.infer<typeof linkInput>) {
  const url = (typeof input === 'string' ? input : input.url).trim()
  const label = typeof input === 'string' ? '' : (input.label?.trim() ?? '')
  return { label: label || url.replace(/^https?:\/\/(?:www\.)?/u, '').replace(/\/$/u, ''), url }
}

function allowedFields(type: SectionType, variant?: string): readonly EntryField[] {
  return type === 'custom' && variant === 'rich' ? ['body'] : sectionDefinitions[type].fields
}

/** Turns an authored entry into a complete stored entry for `type`; `notes` collects changes. */
export function normalizeEntry(
  type: SectionType,
  input: EntryInput,
  notes: string[],
  where: string,
  variant?: string,
): ResumeEntry {
  const fields = allowedFields(type, variant)
  const entry: ResumeEntry = {
    id: input.id ?? crypto.randomUUID(),
    title: input.title?.trim() ?? '',
    organization: input.organization?.trim() ?? '',
    location: input.location?.trim() ?? '',
    start: date(input.start),
    end: date(input.end),
    current: input.current ?? false,
    body: input.body ?? '',
    bullets: (input.bullets ?? []).map((bullet) => bullet.trim()).filter(Boolean),
    link: input.link ? normalizeLink(input.link) : null,
    ...(input.context?.trim() ? { context: input.context.trim() } : {}),
    ...(input.proficiency?.trim() ? { proficiency: input.proficiency.trim() } : {}),
  }
  if (ONGOING.test(entry.end)) {
    entry.end = ''
    entry.current = fields.includes('end')
  }
  if (entry.bullets.length > 0 && !fields.includes('bullets')) {
    if (!fields.includes('body')) throw new Error(`${where}: ${type} entries take no bullets`)
    const joined = entry.bullets.join(['skills', 'languages'].includes(type) ? ', ' : '\n')
    const body = richTextToText(entry.body)
    entry.body =
      typeof entry.body === 'string' && body
        ? `${entry.body}\n${joined}`
        : body
          ? entry.body
          : joined
    entry.bullets = []
    notes.push(`${where}: bullets moved into body (${type} entries have no bullets)`)
  }
  for (const key of SCALARS)
    if (entry[key] && !fields.includes(key)) {
      notes.push(
        `${where}: dropped ${key} "${entry[key]}" (${type} entries take ${fields.join(', ')})`,
      )
      entry[key] = ''
    }
  if (entry.current && !fields.includes('end')) entry.current = false
  if (entry.current && entry.end) entry.end = ''
  if (entry.context && !['experience', 'internship'].includes(type)) {
    notes.push(`${where}: dropped context (only experience and internship entries have it)`)
    delete entry.context
  }
  if (entry.proficiency && !['skills', 'languages'].includes(type)) {
    notes.push(`${where}: dropped proficiency (only skills and languages entries have it)`)
    delete entry.proficiency
  }
  if (entry.link && ['summary', 'skills', 'languages'].includes(type)) {
    notes.push(`${where}: dropped link (${type} entries have no reference link)`)
    entry.link = null
  }
  return entry
}

export function normalizeSection(
  input: SectionInput,
  notes: string[],
  where: string,
): ResumeSection {
  const section: ResumeSection = {
    id: input.id ?? crypto.randomUUID(),
    type: input.type,
    title: input.title?.trim() || sectionDefinitions[input.type].title,
    hidden: input.hidden ?? false,
    entries: (input.entries ?? []).map((entry, index) =>
      normalizeEntry(input.type, entry, notes, `${where}.entries[${index}]`, input.variant),
    ),
    ...(input.columns ? { columns: input.columns } : {}),
    ...(input.showProficiency !== undefined ? { showProficiency: input.showProficiency } : {}),
    ...(input.variant && input.type === 'custom' ? { variant: input.variant } : {}),
  }
  if (input.variant && input.type !== 'custom')
    notes.push(`${where}: dropped variant (only custom sections have one)`)
  return section
}

export function normalizeHeader(input: HeaderInput) {
  const { links, ...fields } = input
  return {
    ...Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value?.trim()])),
    ...(links ? { links: links.map(normalizeLink) } : {}),
  }
}

/** A complete document from authored content; without sections it starts from the template's. */
export function documentFromContent(
  title: string,
  template: TemplateId,
  content: ContentInput | undefined,
  notes: string[],
): ResumeDocument {
  const base = content?.sections
    ? emptyDocument(title)
    : createTemplateDocument(content?.presentation?.template ?? template, title)
  if (!content) return base
  return {
    ...base,
    title,
    targetRole: content.targetRole?.trim() ?? '',
    jobDescription: content.jobDescription ?? '',
    header: { ...base.header, ...normalizeHeader(content.header ?? {}) },
    sections: content.sections
      ? content.sections.map((section, index) =>
          normalizeSection(section, notes, `sections[${index}]`),
        )
      : base.sections,
    presentation: { ...content.presentation, template: content.presentation?.template ?? template },
  }
}
