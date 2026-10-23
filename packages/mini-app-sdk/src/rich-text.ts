import { z } from 'zod'

export type RichMark =
  | { type: 'bold' | 'italic' }
  | {
      type: 'link'
      attrs: { href: string; target?: string | null; rel?: string | null; class?: null }
    }
export type RichInline = { type: 'text'; text: string; marks?: RichMark[] } | { type: 'hardBreak' }
export interface RichParagraph {
  type: 'paragraph'
  content?: RichInline[]
}
export interface RichListItem {
  type: 'listItem'
  content: [RichParagraph, ...RichBlock[]]
}
export type RichBlock =
  | RichParagraph
  | { type: 'bulletList'; content: RichListItem[] }
  | {
      type: 'orderedList'
      attrs?: { start?: number; type?: '1' | 'a' | 'A' | 'i' | 'I' | null }
      content: RichListItem[]
    }
export interface RichTextDocument {
  type: 'doc'
  content: RichBlock[]
}
export type RichTextValue = string | RichTextDocument

export function isRichTextHref(value: string): boolean {
  try {
    return (
      value.length <= 2_000 &&
      ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(value).protocol)
    )
  } catch {
    return false
  }
}
const mark = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({
    type: z.literal('link'),
    attrs: z.strictObject({
      href: z.string().refine(isRichTextHref, 'Use an HTTP, HTTPS, email or telephone link'),
      target: z.enum(['_blank', '_self']).nullable().optional(),
      rel: z.string().max(120).nullable().optional(),
      class: z.null().optional(),
    }),
  }),
])
const inline = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('text'),
    text: z.string().min(1).max(100_000),
    marks: z
      .array(mark)
      .max(3)
      .refine(
        (marks) => new Set(marks.map((value) => value.type)).size === marks.length,
        'Formatting marks must be unique',
      )
      .optional(),
  }),
  z.strictObject({ type: z.literal('hardBreak') }),
])
const paragraph = z.strictObject({
  type: z.literal('paragraph'),
  content: z.array(inline).max(1_000).optional(),
})
const block: z.ZodType<RichBlock> = z.lazy(() =>
  z.discriminatedUnion('type', [
    paragraph,
    z.strictObject({ type: z.literal('bulletList'), content: z.array(item).min(1).max(100) }),
    z.strictObject({
      type: z.literal('orderedList'),
      attrs: z
        .strictObject({
          start: z.number().int().min(1).max(10_000).optional(),
          type: z.enum(['1', 'a', 'A', 'i', 'I']).nullable().optional(),
        })
        .optional(),
      content: z.array(item).min(1).max(100),
    }),
  ]),
)
const item: z.ZodType<RichListItem> = z.lazy(() =>
  z.strictObject({ type: z.literal('listItem'), content: z.tuple([paragraph]).rest(block) }),
)
const document = z.strictObject({ type: z.literal('doc'), content: z.array(block).min(1).max(100) })

/** Validate bounds before recursive parsing, including hostile or accidentally enormous trees. */
export const richTextSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    const queue: Array<{ node: unknown; depth: number }> = [{ node: value, depth: 0 }]
    let textLength = 0
    for (let index = 0; index < queue.length; index++) {
      const { node, depth } = queue[index]!
      if (index >= 1_000 || depth > 12) {
        ctx.addIssue({ code: 'custom', message: 'Rich text exceeds the node or nesting limit' })
        return
      }
      if (!node || typeof node !== 'object') continue
      const record = node as { text?: unknown; content?: unknown }
      if (typeof record.text === 'string') textLength += record.text.length
      if (textLength > 100_000) {
        ctx.addIssue({ code: 'custom', message: 'Rich text exceeds the text limit' })
        return
      }
      if (Array.isArray(record.content)) {
        if (queue.length + record.content.length > 1_000) {
          ctx.addIssue({ code: 'custom', message: 'Rich text exceeds the node limit' })
          return
        }
        for (const child of record.content) queue.push({ node: child, depth: depth + 1 })
      }
    }
  })
  .pipe(document)

export function richTextDocument(value: RichTextValue): RichTextDocument {
  return typeof value === 'string'
    ? {
        type: 'doc',
        content: [
          { type: 'paragraph', ...(value ? { content: [{ type: 'text', text: value }] } : {}) },
        ],
      }
    : value
}
export function richTextToText(value: RichTextValue): string {
  if (typeof value === 'string') return value
  const paragraphText = (node: RichParagraph) =>
    (node.content ?? []).map((part) => (part.type === 'text' ? part.text : '\n')).join('')
  const visit = (node: RichBlock, depth = 0): string =>
    node.type === 'paragraph'
      ? paragraphText(node)
      : node.content
          .map((entry, index) => {
            const prefix =
              node.type === 'orderedList' ? `${(node.attrs?.start ?? 1) + index}. ` : '• '
            return `${'  '.repeat(depth)}${prefix}${entry.content.map((child) => visit(child, depth + 1)).join('\n')}`
          })
          .join('\n')
  return value.content.map((node) => visit(node)).join('\n\n')
}
export function richTextToMarkdown(value: RichTextValue): string {
  const escape = (text: string) => text.replace(/([\\`*_{}[\]<>#|!().+~-])/g, '\\$1')
  if (typeof value === 'string') return escape(value)
  const paragraphText = (node: RichParagraph) =>
    (node.content ?? [])
      .map((part) => {
        if (part.type === 'hardBreak') return '  \n'
        let text = escape(part.text)
        const wrap = (value: string, marker: string) =>
          value.replace(/^(\s*)(.*?)(\s*)$/su, (_match, before, core, after) =>
            core ? `${before}${marker}${core}${marker}${after}` : value,
          )
        if (part.marks?.some((m) => m.type === 'bold')) text = wrap(text, '**')
        if (part.marks?.some((m) => m.type === 'italic')) text = wrap(text, '_')
        const link = part.marks?.find((m) => m.type === 'link')
        if (link?.type === 'link') text = `[${text}](<${new URL(link.attrs.href).href}>)`
        return text
      })
      .join('')
  const visit = (node: RichBlock): string =>
    node.type === 'paragraph'
      ? paragraphText(node)
      : node.content
          .map((entry, index) => {
            const prefix =
              node.type === 'orderedList' ? `${(node.attrs?.start ?? 1) + index}. ` : '- '
            return `${prefix}${entry.content
              .map((child) => visit(child))
              .join('\n')
              .replace(/\n/g, `\n${' '.repeat(prefix.length)}`)}`
          })
          .join('\n')
  return value.content.map((node) => visit(node)).join('\n\n')
}
