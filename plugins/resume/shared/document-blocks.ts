import type { ResumeDocument, ResumeEntry, ResumeSection } from './schema'
import { richTextToText } from '@localixai/plugin-sdk/rich-text'

export type DocumentBlock =
  | { kind: 'header'; id: string; header: ResumeDocument['header'] }
  | { kind: 'heading'; id: string; title: string }
  | { kind: 'entry'; id: string; entry: ResumeEntry }

export function hasEntryContent(entry: ResumeEntry): boolean {
  return [
    entry.title,
    entry.organization,
    entry.location,
    entry.start,
    entry.end,
    richTextToText(entry.body),
    ...entry.bullets,
    entry.link?.label,
    entry.link?.url,
  ].some((value) => Boolean(value?.trim()))
}
export function populatedSections(document: ResumeDocument): ResumeSection[] {
  return document.sections
    .filter((section) => !section.hidden)
    .map((section) => ({
      ...section,
      entries: section.entries.filter(hasEntryContent),
    }))
    .filter((section) => section.entries.length > 0)
}

/** One reading-order projection used by preview, text, Markdown and office export. */
export function documentBlocks(document: ResumeDocument): DocumentBlock[] {
  return [
    { kind: 'header', id: 'header', header: document.header },
    ...populatedSections(document).flatMap((section): DocumentBlock[] => [
      { kind: 'heading', id: section.id, title: section.title },
      ...section.entries.map((entry): DocumentBlock => ({ kind: 'entry', id: entry.id, entry })),
    ]),
  ]
}
export function entryMetadata(entry: ResumeEntry): string {
  return [
    entry.location,
    [entry.start, entry.current ? 'Present' : entry.end].filter(Boolean).join(' – '),
  ]
    .filter(Boolean)
    .join(' · ')
}
