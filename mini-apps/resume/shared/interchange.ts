import { parse, stringify } from 'yaml'
import { richTextToMarkdown } from '@localixai/mini-app-sdk/rich-text'
import {
  documentSchema,
  emptyDocument,
  emptyEntry,
  presentationSchema,
  type ResumeDocument,
} from './schema'
import { sectionLabels } from './presentation'
import { markdownBody } from './markdown'
import {
  interchangeSchema,
  interchangeKeys as keys,
  interchangeFields,
  assertInterchangeSections,
} from './interchange-contract'
import { assertInterchangeExport } from './interchange-export'

function isoDate(value = ''): string {
  if (!value || /^(?:\d{4}(?:-\d{2})?)$/u.test(value)) return value
  const match = /^(\w+)\s+(\d{4})$/u.exec(value)
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ]
  const index = match ? months.indexOf(match[1].slice(0, 3).toLowerCase()) : -1
  if (match && index >= 0) return `${match[2]}-${String(index + 1).padStart(2, '0')}`
  throw new Error(`Unrecognized date “${value}”. Use YYYY or YYYY-MM in the source file.`)
}
export function importInterchange(input: unknown): ResumeDocument {
  const native = documentSchema.safeParse(input)
  if (native.success) return native.data
  const data = interchangeSchema.parse(input)
  assertInterchangeSections(data.sections ?? [])
  const document = emptyDocument(data.title || 'Imported resume')
  const values: Record<string, unknown> = data
  const styles = Object.fromEntries(
    Object.keys(presentationSchema.shape)
      .filter((key) => key !== 'template' && values[key] !== undefined)
      .map((key) => [key, values[key]]),
  )
  document.presentation = presentationSchema.parse({ ...styles, template: data.template || 'awal' })
  const h = data.header ?? {}
  const known = [
    'firstName',
    'lastName',
    'jobTitle',
    'email',
    'phone',
    'city',
    'province',
    'country',
    'website',
    'linkedin',
    'link',
  ]
  if (Object.keys(h).some((key) => !known.includes(key)))
    throw new Error(
      'This header contains unsupported fields. Use portable Lanjut interchange JSON or YAML.',
    )
  document.header = {
    name: [h.firstName, h.lastName].filter(Boolean).join(' '),
    headline: h.jobTitle || '',
    email: h.email || '',
    phone: h.phone || '',
    location: [h.city, h.province, h.country].filter(Boolean).join(', '),
    links: [],
    ...(data.photo ? { photo: data.photo } : {}),
  }
  for (const [key, label] of [
    ['website', 'Website'],
    ['linkedin', 'LinkedIn'],
    ['link', 'Link'],
  ]) {
    if (!h[key]) continue
    const url =
      key === 'linkedin' && !h[key].includes('/')
        ? `https://linkedin.com/in/${h[key]}`
        : /^https?:/u.test(h[key])
          ? h[key]
          : `https://${h[key]}`
    document.header.links.push({ label, url })
  }
  document.sections = (data.sections ?? []).map((section) => {
    const singleton =
      section.type === 'summary' ||
      (section.type === 'custom' && (section.variant ?? 'rich') === 'rich')
    const entries = singleton ? [{ body: section.body || '' }] : (section.entries ?? [])
    return {
      id: crypto.randomUUID(),
      type: section.type,
      title: section.title || sectionLabels[document.presentation.language ?? 'en'][section.type],
      hidden: section.hidden ?? false,
      columns: section.columns,
      showProficiency: section.showProficiency,
      ...(section.type === 'custom' ? { variant: section.variant ?? 'rich' } : {}),
      entries: entries.map((record) => {
        const entry = emptyEntry()
        const mapping = keys[section.type]
        const allowed = singleton ? ['body'] : interchangeFields(section.type)
        const extra = Object.keys(record).filter((key) => !allowed.includes(key))
        if (extra.length)
          throw new Error(`Unsupported ${section.type} fields: ${extra.join(', ')}.`)
        for (const [to, from] of Object.entries(mapping)) {
          const value = record[from] || ''
          Object.assign(entry, { [to]: to === 'body' ? markdownBody(value) : value })
        }
        if (singleton) entry.body = markdownBody(record.body || '')
        entry.start = isoDate(record.startDate)
        entry.current = /^(present|current|sekarang)$/iu.test(record.endDate || '')
        entry.end = entry.current ? '' : isoDate(record.endDate)
        const url = record.website || record.url
        if (url) entry.link = { label: '', url: /^https?:/u.test(url) ? url : `https://${url}` }
        return entry
      }),
    }
  })
  return documentSchema.parse(document)
}
export function parseResumeFile(text: string, filename: string): ResumeDocument {
  if (text.length > 400_000) throw new Error('Resume file exceeds 400 KB.')
  const input = /\.ya?ml$/iu.test(filename) ? parse(text, { maxAliasCount: 0 }) : JSON.parse(text)
  return importInterchange(input)
}
export function exportYaml(document: ResumeDocument): string {
  // Native YAML keeps every Localix field, including context and optional presentation metadata.
  return stringify(document, { aliasDuplicateObjects: false })
}
export function exportInterchange(document: ResumeDocument): string {
  assertInterchangeExport(document)
  const [firstName = '', ...lastName] = document.header.name.split(' ')
  return JSON.stringify(
    {
      format: 'lanjut-resume',
      version: 1,
      title: document.title,
      ...document.presentation,
      photo: document.header.photo ?? undefined,
      header: {
        firstName,
        lastName: lastName.join(' '),
        jobTitle: document.header.headline,
        email: document.header.email,
        phone: document.header.phone,
        city: document.header.location,
        ...Object.fromEntries(
          document.header.links
            .slice(0, 3)
            .map((link, i) => [['website', 'linkedin', 'link'][i], link.url]),
        ),
      },
      sections: document.sections.map((section) => ({
        type: section.type,
        title: section.title,
        hidden: section.hidden,
        ...(['skills', 'languages'].includes(section.type)
          ? { columns: section.columns, showProficiency: section.showProficiency }
          : {}),
        ...(section.type === 'custom' ? { variant: section.variant ?? 'list' } : {}),
        ...(section.type === 'summary' || (section.type === 'custom' && section.variant !== 'list')
          ? { body: richTextToMarkdown(section.entries[0]?.body ?? '') }
          : {
              entries: section.entries.map((entry) => ({
                ...Object.fromEntries(
                  Object.entries(keys[section.type]).map(([from, to]) => [
                    to,
                    from === 'body'
                      ? [
                          richTextToMarkdown(entry.body),
                          ...entry.bullets.map(
                            (text) => `- ${text.replace(/([\\`*_{}[\]<>#!])/gu, '\\$1')}`,
                          ),
                        ]
                          .filter(Boolean)
                          .join('\n')
                      : entry[from as keyof typeof entry] || '',
                  ]),
                ),
                ...(['skills', 'languages', 'certifications'].includes(section.type)
                  ? {}
                  : { startDate: entry.start, endDate: entry.current ? 'Present' : entry.end }),
                ...(entry.link
                  ? { [section.type === 'certifications' ? 'url' : 'website']: entry.link.url }
                  : {}),
              })),
            }),
      })),
    },
    null,
    2,
  )
}
