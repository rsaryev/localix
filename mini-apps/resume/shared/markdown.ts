import {
  isRichTextHref,
  richTextSchema,
  type RichInline,
  type RichMark,
  type RichBlock,
  type RichTextDocument,
} from '@localixai/mini-app-sdk/rich-text'

/** Parse the small interchange dialect. Unsupported HTML and syntax remain literal text. */
export function markdownBody(source: string): RichTextDocument {
  function inline(text: string, inherited: RichMark[] = []): RichInline[] {
    const output: RichInline[] = []
    let plain = ''
    const flush = () => {
      if (plain)
        output.push({
          type: 'text',
          text: plain,
          ...(inherited.length ? { marks: inherited } : {}),
        })
      plain = ''
    }
    for (let index = 0; index < text.length;) {
      if (text[index] === '\\' && index + 1 < text.length) {
        plain += text[index + 1]
        index += 2
        continue
      }
      const rest = text.slice(index)
      const link = /^\[([^\]]+)\]\((?:<([^>]+)>|([^\s)]+))\)/u.exec(rest)
      if (link && isRichTextHref(link[2] || link[3])) {
        flush()
        output.push(
          ...inline(link[1], [...inherited, { type: 'link', attrs: { href: link[2] || link[3] } }]),
        )
        index += link[0].length
        continue
      }
      const marker = rest.startsWith('**') ? '**' : rest.startsWith('*') ? '*' : null
      if (marker) {
        const end = text.indexOf(marker, index + marker.length)
        const type = marker === '**' ? 'bold' : 'italic'
        if (end > index + marker.length && !inherited.some((mark) => mark.type === type)) {
          flush()
          output.push(...inline(text.slice(index + marker.length, end), [...inherited, { type }]))
          index = end + marker.length
          continue
        }
      }
      plain += text[index++]
    }
    flush()
    return output
  }
  const blocks: RichBlock[] = []
  const lines = source.split(/\r?\n/u)
  for (const line of lines) {
    if (!line.trim()) continue
    const match = /^\s*(?:[-*•]\s+|(\d+)\.\s+)(.*)$/u.exec(line)
    const paragraph = { type: 'paragraph' as const, content: inline(match ? match[2] : line) }
    if (!match) {
      blocks.push(paragraph)
      continue
    }
    const type = match[1] ? 'orderedList' : 'bulletList'
    const last = blocks.at(-1)
    const item = { type: 'listItem' as const, content: [paragraph] as [typeof paragraph] }
    if (last?.type === type) last.content.push(item)
    else if (type === 'orderedList')
      blocks.push({ type, attrs: { start: Number(match[1]) }, content: [item] })
    else blocks.push({ type, content: [item] })
  }
  return richTextSchema.parse({
    type: 'doc',
    content: blocks.length ? blocks : [{ type: 'paragraph' }],
  })
}
