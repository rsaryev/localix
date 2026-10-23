import { z } from 'zod'
import { portraitSchema } from '@localixai/mini-app-sdk/document-layout'
import { presentationSchema, sectionTypes, type SectionType } from './schema'

const scalar = z.union([z.string(), z.number()]).transform(String)
const fields = z.record(z.string(), scalar)
export const interchangeSchema = z.strictObject({
  format: z.literal('lanjut-resume'),
  version: z.literal(1),
  title: z.string().optional(),
  header: fields.optional(),
  sections: z
    .array(
      z.strictObject({
        type: z.enum(sectionTypes),
        title: z.string().optional(),
        hidden: z.boolean().optional(),
        body: scalar.optional(),
        entries: z.array(fields).optional(),
        variant: z.enum(['rich', 'list']).optional(),
        columns: z.union([z.literal(1), z.literal(2)]).optional(),
        showProficiency: z.boolean().optional(),
      }),
    )
    .max(24)
    .optional(),
  ...presentationSchema.shape,
  template: presentationSchema.shape.template.optional(),
  photo: portraitSchema.optional(),
})

export const interchangeKeys: Record<SectionType, Record<string, string>> = {
  summary: {},
  experience: {
    title: 'title',
    organization: 'company',
    context: 'companyContext',
    location: 'location',
    body: 'description',
  },
  internship: {
    title: 'title',
    organization: 'company',
    context: 'companyContext',
    location: 'location',
    body: 'description',
  },
  projects: { title: 'title', organization: 'company', body: 'description' },
  organizations: { title: 'role', organization: 'organization', body: 'description' },
  education: {
    title: 'degree',
    organization: 'institution',
    location: 'location',
    body: 'details',
  },
  certifications: { title: 'name', organization: 'issuer' },
  skills: { title: 'name', proficiency: 'level' },
  languages: { title: 'name', proficiency: 'level' },
  custom: { title: 'title', organization: 'subtitle', body: 'description' },
}

const dated = ['experience', 'internship', 'projects', 'organizations', 'education', 'custom']
const linked = ['experience', 'internship', 'projects']
export function interchangeFields(type: SectionType) {
  return [
    ...Object.values(interchangeKeys[type]),
    ...(dated.includes(type) ? ['startDate', 'endDate'] : []),
    ...(linked.includes(type) ? ['website'] : type === 'certifications' ? ['url'] : []),
  ]
}
export function assertInterchangeSections(
  sections: Array<{
    type: SectionType
    variant?: string
    body?: unknown
    entries?: unknown
    columns?: number
    showProficiency?: boolean
  }>,
) {
  const seen = new Set<string>()
  for (const section of sections) {
    if (section.type !== 'custom' && seen.has(section.type))
      throw new Error(`Duplicate ${section.type} section. Use Localix JSON or YAML.`)
    seen.add(section.type)
    const rich =
      section.type === 'summary' ||
      (section.type === 'custom' && (section.variant ?? 'rich') === 'rich')
    if ((rich && section.entries !== undefined) || (!rich && section.body !== undefined))
      throw new Error('Rich sections use body; list sections use entries.')
    if (
      !['skills', 'languages'].includes(section.type) &&
      (section.columns !== undefined || section.showProficiency !== undefined)
    )
      throw new Error('Grid controls require skills or languages.')
    if (section.type !== 'custom' && section.variant !== undefined)
      throw new Error('Variant requires a custom section.')
  }
}
