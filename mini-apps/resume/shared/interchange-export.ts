import { richTextToText } from '@localixai/mini-app-sdk/rich-text'
import type { ResumeDocument } from './schema'
import { interchangeKeys } from './interchange-contract'

/** Reference interchange cannot express every Localix extension. Never silently drop prose. */
export function assertInterchangeExport(document: ResumeDocument) {
  const reject = (reason: string): never => {
    throw new Error(
      `${reason} Lanjut cannot preserve these fields. Export Localix JSON or YAML instead.`,
    )
  }
  if (document.header.links.length > 3) reject('More than three header links.')
  const seen = new Set<string>()
  for (const section of document.sections) {
    if (section.type !== 'custom' && seen.has(section.type))
      reject(`Duplicate ${section.type} section.`)
    seen.add(section.type)
    for (const entry of section.entries) {
      const mapping = interchangeKeys[section.type]
      const singleton =
        section.type === 'summary' || (section.type === 'custom' && section.variant === 'rich')
      for (const field of ['title', 'organization', 'location', 'context', 'proficiency'] as const)
        if (entry[field] && !mapping[field]) reject(`${section.title}: ${field}.`)
      if (
        !singleton &&
        !mapping.body &&
        (richTextToText(entry.body).trim() || entry.bullets.length)
      )
        reject(`${section.title}: description.`)
      if (section.type === 'certifications' && (entry.start || entry.end || entry.current))
        reject('Certification dates.')
      if (
        entry.link &&
        !['experience', 'internship', 'projects', 'certifications'].includes(section.type)
      )
        reject(`${section.title}: reference link.`)
    }
  }
}
