import {
  emptyDocument,
  emptyEntry,
  sectionTypes,
  type ResumeDocument,
  type SectionType,
} from './schema'
import { sectionLabels } from './presentation'
import { sourceEntries } from './source-entries'
const aliases: Partial<Record<SectionType, string[]>> = {
  summary: ['profile', 'about me', 'objective', 'профиль', 'о себе'],
  experience: ['work experience', 'employment history', 'опыт работы'],
  internship: ['internships', 'магang', 'стажировки'],
  projects: ['portfolio', 'проекты'],
  education: ['academic background', 'образование'],
  organizations: ['volunteering', 'организации'],
  certifications: ['certification', 'сертификаты'],
  skills: ['technical skills', 'навыки'],
  languages: ['языки'],
}
/** Conservative source import: infer headings, retain the source's prose, and expose uncertain text. */
export function importSourceText(
  text: string,
  title: string,
): { document: ResumeDocument; leftovers: string } {
  if (text.length > 100_000)
    throw new Error('Extracted resume exceeds 100,000 characters. Import a smaller source.')
  const document = emptyDocument(title)
  const leftover: string[] = []
  const groups: Array<{ type: SectionType; title: string; lines: string[] }> = []
  let group: (typeof groups)[number] | null = null
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(/^#{1,6}\s+/u, '').trim()
    const normalized = line.replace(/[:：]$/u, '').toLowerCase()
    const type =
      line.length <= 60
        ? sectionTypes.find((type) =>
            [sectionLabels.en[type], sectionLabels.id[type], ...(aliases[type] ?? [])].some(
              (label) => label.toLowerCase() === normalized,
            ),
          )
        : undefined
    if (type) {
      group = { type, title: line.replace(/[:：]$/u, ''), lines: [] }
      groups.push(group)
    } else if (group) group.lines.push(raw)
    else leftover.push(raw)
  }
  // Header candidates are shown for review; lines that are not recognized remain unassigned.
  const name =
    leftover
      .find((line) => line.trim())
      ?.replace(/^#{1,6}\s+/u, '')
      .trim() ?? ''
  if (name && name.length < 80 && !/[@:/]/u.test(name)) {
    document.header.name = name
    leftover.splice(
      leftover.findIndex((line) => line.includes(name)),
      1,
    )
  }
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu)?.[0]
  if (email) document.header.email = email
  document.sections = groups.map((group) => ({
    id: crypto.randomUUID(),
    type: group.type,
    title: group.title,
    hidden: false,
    entries:
      group.type === 'skills' || group.type === 'languages'
        ? group.lines
            .filter((line) => line.trim())
            .map((line) => ({ ...emptyEntry(), title: line.replace(/^[-*•]\s*/u, '').trim() }))
        : sourceEntries(group.lines, group.type),
  }))
  return { document, leftovers: leftover.join('\n').trim() }
}
