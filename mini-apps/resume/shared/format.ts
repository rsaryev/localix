import { documentBlocks, entryMetadata } from './document-blocks'
import { richTextToText, richTextToMarkdown } from '@localixai/mini-app-sdk/rich-text'
import type { ResumeDocument, ResumeEntry, ResumeSection } from './schema'
import { exportInterchange, exportYaml } from './interchange'

export type ExportFormat = 'json' | 'markdown' | 'text' | 'yaml' | 'lanjut'
// User prose never turns into Markdown layout or executable HTML.
const escapeMarkdown = (text: string) => text.replace(/([\\`*_{}[\]<>#|!().+~-])/g, '\\$1')
export function entryLines(entry: ResumeEntry): string[] {
  return [
    [entry.title, entry.organization].filter(Boolean).join(' — '),
    entryMetadata(entry),
    entry.context ?? '',
    entry.proficiency ?? '',
    richTextToText(entry.body),
    ...entry.bullets.filter((bullet) => bullet.trim()).map((bullet) => `• ${bullet}`),
    entry.link ? `${entry.link.label || entry.link.url}: ${entry.link.url}` : '',
  ].filter((line) => line.trim())
}
export function sectionText(section: ResumeSection): string {
  return [section.title, ...section.entries.map((entry) => entryLines(entry).join('\n'))].join(
    '\n\n',
  )
}
function markdownEntry(entry: ResumeEntry): string {
  return [
    [entry.title, entry.organization].filter(Boolean).map(escapeMarkdown).join(' — '),
    escapeMarkdown(entryMetadata(entry)),
    escapeMarkdown(entry.context ?? ''),
    escapeMarkdown(entry.proficiency ?? ''),
    richTextToMarkdown(entry.body),
    entry.bullets
      .filter((bullet) => bullet.trim())
      .map((bullet) => `- ${escapeMarkdown(bullet).replaceAll('\n', '\n  ')}`)
      .join('\n'),
    entry.link
      ? `[${escapeMarkdown(entry.link.label || entry.link.url)}](<${new URL(entry.link.url).href}>)`
      : '',
  ]
    .filter((line) => line.trim())
    .join('\n\n')
}

/** Formatting never changes the canonical reading order or includes role-context notes. */
export function exportDocument(document: ResumeDocument, format: ExportFormat): string {
  if (format === 'json') return JSON.stringify(document, null, 2)
  if (format === 'yaml') return exportYaml(document)
  if (format === 'lanjut') return exportInterchange(document)
  const markdown = format === 'markdown'
  const text = documentBlocks(document)
    .map((block) => {
      if (block.kind === 'heading')
        return markdown ? `## ${escapeMarkdown(block.title)}` : block.title
      if (block.kind === 'entry')
        return markdown ? markdownEntry(block.entry) : entryLines(block.entry).join('\n')
      const h = block.header
      const contact = [h.email, h.phone, h.location].filter(Boolean).join(' · ')
      return [
        h.name ? (markdown ? `# ${escapeMarkdown(h.name)}` : h.name) : '',
        markdown ? escapeMarkdown(h.headline) : h.headline,
        markdown ? escapeMarkdown(contact) : contact,
        ...h.links.map((link) =>
          markdown
            ? `[${escapeMarkdown(link.label || link.url)}](<${new URL(link.url).href}>)`
            : `${link.label || link.url}: ${link.url}`,
        ),
      ]
        .filter((line) => line.trim())
        .join('\n\n')
    })
    .filter((block) => block.trim())
    .join('\n\n')
  return text ? `${text.trim()}\n` : ''
}
