import {
  documentLayoutSchema,
  type DocumentLayout,
  type DocumentParagraph,
  type DocumentRun,
} from '@localixai/mini-app-sdk/document-layout'
import {
  richTextDocument,
  type RichBlock,
  type RichTextValue,
} from '@localixai/mini-app-sdk/rich-text'
import { populatedSections, entryMetadata } from './document-blocks'
import { presentationFor } from './presentation'
import type { ResumeDocument } from './schema'

/** Restricted rich text becomes styled, selectable runs without HTML interpretation. */
export function richParagraphs(
  value: RichTextValue,
): Array<{ runs: DocumentRun[]; indent: number }> {
  const result: Array<{ runs: DocumentRun[]; indent: number }> = []
  const visit = (blocks: RichBlock[], indent = 0, prefix = '') => {
    blocks.forEach((block) => {
      if (block.type === 'paragraph') {
        const runs: DocumentRun[] = prefix ? [{ text: prefix }] : []
        for (const inline of block.content ?? []) {
          if (inline.type === 'hardBreak') runs.push({ text: '\n' })
          else
            runs.push({
              text: inline.text,
              bold: inline.marks?.some((mark) => mark.type === 'bold'),
              italic: inline.marks?.some((mark) => mark.type === 'italic'),
              href: inline.marks?.find((mark) => mark.type === 'link')?.attrs.href,
            })
        }
        if (runs.some((run) => run.text.trim())) result.push({ runs, indent })
      } else
        block.content.forEach((item, index) => {
          visit(
            [item.content[0]],
            indent + 12,
            block.type === 'orderedList' ? `${(block.attrs?.start ?? 1) + index}. ` : '• ',
          )
          visit(item.content.slice(1), indent + 12)
        })
    })
  }
  visit(richTextDocument(value).content)
  return result
}

/** Shared styled document sent to Documents for both live A4 preview and downloadable exports. */
export function resumeLayout(document: ResumeDocument): DocumentLayout {
  const style = presentationFor(document)
  const p = document.presentation
  const blocks: DocumentLayout['blocks'] = []
  const paragraph = (
    runs: DocumentRun[],
    overrides: Partial<DocumentParagraph> = {},
  ): DocumentParagraph => ({
    kind: 'paragraph',
    runs,
    font: style.font,
    size: style.body,
    align: 'left',
    before: 0,
    after: 4,
    indent: 0,
    lineHeight: style.lineHeight,
    tracking: style.tracking,
    ...overrides,
  })
  const text = (value: string, overrides: Partial<DocumentParagraph> = {}, bold = false) => {
    if (value.trim()) blocks.push(paragraph([{ text: value, bold }], overrides))
  }
  const h = document.header
  const align = style.centered ? 'center' : 'left'
  const left: DocumentParagraph[] = []
  if (h.name)
    left.push(
      paragraph([{ text: h.name, bold: ['awal', 'tebal', 'ketik'].includes(p.template) }], {
        font: style.accent,
        size: style.name,
        align,
        after: 2,
      }),
    )
  if (h.headline)
    left.push(
      paragraph([{ text: h.headline }], {
        font: style.accent,
        size: 10.5 * (p.nameScale ?? 1),
        align,
        muted: true,
        after: 5,
      }),
    )
  const right: DocumentParagraph[] = []
  const showIcons = (p.showIcons ?? true) && ['awal', 'ketat', 'tebal'].includes(p.template)
  const contact = (value: string, icon: DocumentParagraph['icon'], href?: string) => {
    if (!value) return
    right.push(
      paragraph(
        [{ text: value, href: href && /^(https?:|mailto:|tel:)/u.test(href) ? href : undefined }],
        { align, size: style.body, muted: true, after: 3, icon: showIcons ? icon : undefined },
      ),
    )
  }
  contact(h.email, 'email', h.email.includes('@') ? `mailto:${h.email}` : undefined)
  contact(h.phone, 'phone', `tel:${h.phone.replace(/[^+\d]/gu, '')}`)
  contact(h.location, 'location')
  h.links.forEach((link) =>
    contact(link.label || link.url, 'link', /^https?:/u.test(link.url) ? link.url : undefined),
  )
  const splitHeader = ['awal', 'ketat'].includes(p.template)
  blocks.push({
    kind: 'header',
    left: splitHeader ? left : [...left, ...right],
    right: splitHeader ? right : [],
    centered: style.centered,
    ...(h.photo
      ? {
          photo: {
            data: h.photo,
            size: style.photoSize,
            radius: style.photoRadius,
            align: p.photoAlign ?? 'top',
          },
        }
      : {}),
  })
  for (const section of populatedSections(document)) {
    const title = style.uppercase
      ? section.title.toLocaleUpperCase(p.language ?? 'en')
      : section.title
    if (style.rule === 'top' || style.rule === 'double') {
      // Spacing belongs to the heading, so the rule and title stay together.
      blocks.push(paragraph([], { before: style.gap, after: 0 }))
      blocks.push({ kind: 'rule', width: style.rule === 'top' ? 2 : 0.75 })
    }
    text(
      title,
      {
        font: style.accent,
        size: style.heading,
        before: style.rule === 'top' || style.rule === 'double' ? 0 : style.gap,
        align: style.rule === 'double' ? 'center' : 'left',
        after: 4,
        keepWithNext: true,
      },
      true,
    )
    if (['bottom', 'double', 'dashed'].includes(style.rule))
      blocks.push({ kind: 'rule', width: 0.75, dashed: style.rule === 'dashed' })
    if (section.type === 'skills' || section.type === 'languages') {
      const rows = section.entries.map((entry) => {
        const detail = [
          entry.proficiency,
          ...richParagraphs(entry.body).map((item) => item.runs.map((run) => run.text).join('')),
        ]
          .filter(Boolean)
          .join(' · ')
        return paragraph([
          { text: entry.title, bold: true },
          ...(detail ? [{ text: ` — ${detail}` }] : []),
        ])
      })
      const columns = section.columns ?? 2
      blocks.push({
        kind: 'columns',
        columns:
          columns === 1
            ? [rows]
            : [rows.filter((_, i) => i % 2 === 0), rows.filter((_, i) => i % 2 !== 0)],
      })
      continue
    }
    section.entries.forEach((entry, index) => {
      const left: DocumentParagraph[] = []
      if (entry.title)
        left.push(
          paragraph(
            [
              {
                text: p.template === 'luasa' ? entry.title.toUpperCase() : entry.title,
                bold: p.template !== 'luasa',
              },
            ],
            {
              font: p.template === 'ketik' ? style.accent : style.font,
              size: style.body + 0.5,
              after: 2,
            },
          ),
        )
      if (entry.organization)
        left.push(paragraph([{ text: entry.organization }], { muted: true, after: 2 }))
      if (entry.location)
        left.push(paragraph([{ text: entry.location }], { muted: true, after: 2 }))
      const dates = entryMetadata({ ...entry, location: '' }, p.language)
      if (left.length || dates) {
        blocks.push(paragraph([], { before: index ? 8 : 3, after: 0 }))
        blocks.push({
          kind: 'header',
          left,
          right: dates
            ? [paragraph([{ text: dates }], { align: 'right', muted: true, after: 0 })]
            : [],
          centered: false,
        })
      }
      text(entry.context ?? '', { muted: true, after: 3 })
      richParagraphs(entry.body).forEach((item) =>
        blocks.push(paragraph(item.runs, { indent: item.indent })),
      )
      entry.bullets
        .filter(Boolean)
        .forEach((bullet) => text(`• ${bullet}`, { indent: 12, after: 3 }))
      if (entry.link)
        blocks.push(
          paragraph(
            [
              {
                text: entry.link.label || entry.link.url,
                href: /^https?:/u.test(entry.link.url) ? entry.link.url : undefined,
              },
            ],
            { after: 5 },
          ),
        )
    })
  }
  return documentLayoutSchema.parse({
    title: document.title,
    margin: style.margin,
    blocks,
    pageNumbers: true,
  })
}
