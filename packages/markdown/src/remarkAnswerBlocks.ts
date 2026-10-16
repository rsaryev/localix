// remark plugin: the answer dialect's block constructs (`./dialect`).
//
// Plain GFM gives an agent one way to set text apart — a grey quote — so a warning, a tip and
// a cited sentence all looked the same. This pass keeps the source plain Markdown (it still
// reads correctly as text, on GitHub, or pasted anywhere) and only re-labels nodes the
// renderer already emits:
//   `> [!WARNING]` quote        → blockquote carrying `data-callout` (+ `data-callout-title`)
//   `> — Author` closing line   → the quote's <footer> attribution
//   an image alone in a paragraph → a centred <figure>, captioned by its title
//     (`![alt](src "Caption")`) or by an emphasis-only line right under it (`*Caption*`)
//   `## 1.2 Title`              → the section number set apart, quieter than the title
//   `> [!STEPS]`, `[!TABS]`, `[!STATS]`, `[!PROS]`/`[!CONS]` → container forms, shaped by
//     `remarkAnswerContainers.ts` (a timeline, tabs, a row of figures, the case for and against)
// Everything stays in mdast `data.hName`/`hProperties`, so no raw HTML is produced and the
// sanitize pipeline has nothing new to trust.
import { visit } from 'unist-util-visit'
import type {
  Blockquote,
  Heading,
  Image,
  Paragraph,
  Parents,
  PhrasingContent,
  Root,
  Text,
} from 'mdast'
import { ATTRIBUTION_PREFIX, parseCalloutMarker } from './dialect'
import { applyContainer, isShapedContainer } from './remarkAnswerContainers'

/** Strip a `[!KIND]` marker off the quote's first paragraph; true when it was a callout. */
function applyCallout(quote: Blockquote): boolean {
  const first = quote.children[0]
  if (first?.type !== 'paragraph') return false
  const lead = first.children[0]
  if (lead?.type !== 'text') return false
  const marker = parseCalloutMarker(lead.value)
  if (!marker) return false

  // The title is the marker line's own text. When that line carries formatting (`[!TIP] **x**`)
  // the lead text node ends before the line does, so the line is body content instead.
  const titleIsWholeLine = marker.consumed < lead.value.length || first.children.length === 1
  const title = titleIsWholeLine ? marker.title : ''
  lead.value = titleIsWholeLine
    ? lead.value.slice(marker.consumed)
    : lead.value.slice(lead.value.indexOf(']') + 1).trimStart()
  if (lead.value === '') first.children.shift()
  if (first.children.length === 0) quote.children.shift()

  quote.data = {
    ...quote.data,
    hProperties: {
      dataCallout: marker.kind,
      ...(title ? { dataCalloutTitle: title } : {}),
    },
  }
  return true
}

/**
 * Where the attribution starts inside a paragraph: its first node (`> — Author` as its own
 * paragraph) or a line inside it (`> quote\n> — Author`, the common single-paragraph form).
 */
function attributionSplit(paragraph: Paragraph): { index: number; offset: number } | null {
  for (let index = paragraph.children.length - 1; index >= 0; index -= 1) {
    const node = paragraph.children[index]
    if (node.type !== 'text') continue
    const lines = node.value.split('\n')
    for (let line = lines.length - 1; line >= 0; line -= 1) {
      if (!ATTRIBUTION_PREFIX.test(lines[line])) continue
      const atParagraphStart = index === 0 && line === 0
      const afterBreak = line === 0 && paragraph.children[index - 1]?.type === 'break'
      if (line === 0 && !atParagraphStart && !afterBreak) continue
      const offset = lines.slice(0, line).reduce((sum, text) => sum + text.length + 1, 0)
      return { index, offset }
    }
  }
  return null
}

/** Move a quote's closing `— Author` line into a footer paragraph of its own. */
function applyAttribution(quote: Blockquote): void {
  const last = quote.children.at(-1)
  if (last?.type !== 'paragraph') return
  const split = attributionSplit(last)
  if (!split) return
  // A quote that is nothing but its source line has no quotation to attribute.
  if (quote.children.length === 1 && split.index === 0 && split.offset === 0) return

  const node = last.children[split.index] as Text
  const lead: PhrasingContent[] = last.children.slice(0, split.index)
  if (lead.at(-1)?.type === 'break') lead.pop()
  const before = node.value.slice(0, split.offset).replace(/\n$/, '')
  if (before) lead.push({ type: 'text', value: before })
  const sourceText = node.value.slice(split.offset).replace(ATTRIBUTION_PREFIX, '')
  const source: PhrasingContent[] = [
    ...(sourceText ? [{ type: 'text', value: sourceText } as Text] : []),
    ...last.children.slice(split.index + 1),
  ]
  const footer: Paragraph = {
    type: 'paragraph',
    data: { hName: 'footer', hProperties: { className: ['lx-quote-source'] } },
    children: source,
  }
  if (lead.length === 0) quote.children.splice(-1, 1, footer)
  else {
    last.children = lead
    quote.children.push(footer)
  }
}

const meaningful = (children: PhrasingContent[]) =>
  children.filter((child) => !(child.type === 'text' && child.value.trim() === ''))

/** The caption a line right under an image carries: that line is one emphasis and nothing else. */
function emphasisCaption(next: Parents['children'][number] | undefined): PhrasingContent[] | null {
  if (next?.type !== 'paragraph') return null
  const content = meaningful(next.children)
  return content.length === 1 && content[0].type === 'emphasis' ? content[0].children : null
}

/**
 * An image alone in its paragraph is a figure: centred and bounded, rather than an inline
 * image stretched across the reply. Its caption is the image title, or — the way models and
 * people most often write one — an `*emphasis-only*` line directly under it, which is then
 * consumed into the figure instead of trailing it as a stray italic paragraph.
 */
function applyFigure(paragraph: Paragraph, index: number, parent: Parents): void {
  const content = meaningful(paragraph.children)
  const image = content[0]
  if (image?.type !== 'image') return
  // `![alt](src)` then `*Caption*` on the very next line is ONE paragraph: image, a line
  // break, emphasis. The break must be there — `![a](b) *c*` on one line is prose.
  const sameParagraph =
    content.length === 2 &&
    content[1].type === 'emphasis' &&
    paragraph.children.some((child) => child.type === 'text' && child.value.includes('\n'))
  if (content.length !== 1 && !sameParagraph) return
  const title = (image as Image).title?.trim()
  let underneath: PhrasingContent[] | null = null
  if (sameParagraph)
    underneath = (content[1] as Extract<PhrasingContent, { type: 'emphasis' }>).children
  else if (!title) {
    underneath = emphasisCaption(parent.children[index + 1])
    if (underneath) parent.children.splice(index + 1, 1)
  }
  const caption: PhrasingContent[] | null = title ? [{ type: 'text', value: title }] : underneath
  // A class of its own: code blocks and diagrams are <figure>s with a <figcaption> toolbar too.
  paragraph.data = {
    ...paragraph.data,
    hName: 'figure',
    hProperties: { className: ['lx-figure'] },
  }
  paragraph.children = [
    image,
    // `emphasis` is only a phrasing carrier here: hName turns the element into the caption.
    ...(caption
      ? [{ type: 'emphasis', data: { hName: 'figcaption' }, children: caption } as PhrasingContent]
      : []),
  ]
}

const SECTION_NUMBER = /^(\d+(?:\.\d+)*\.?)[ \t]+/

/**
 * A heading the author numbered (`## 1.2 Water temperature`) gets its number as a quieter span,
 * so the title reads first and the number as the outline position it is. Only a number the text
 * already carries is styled; nothing is numbered that the author did not number.
 */
function applySectionNumber(heading: Heading): void {
  const lead = heading.children[0]
  if (lead?.type !== 'text') return
  const match = SECTION_NUMBER.exec(lead.value)
  if (!match || match[0].length === lead.value.length) return
  lead.value = lead.value.slice(match[0].length)
  heading.children.unshift({
    type: 'emphasis',
    data: { hName: 'span', hProperties: { className: ['lx-section-number'] } },
    children: [{ type: 'text', value: match[1] }],
  })
}

export function remarkAnswerBlocks() {
  return (tree: Root) => {
    visit(tree, (node, index, parent): number | undefined => {
      if (node.type === 'blockquote') {
        // A container this pass already shaped (a tab, a pros/cons aside) is not a quote.
        if (isShapedContainer(node)) return undefined
        // Replaced in place: revisit the index so what replaced the quote is walked too.
        if (parent && index !== undefined && applyContainer(node, index, parent)) return index
        if (!applyCallout(node)) applyAttribution(node)
      } else if (node.type === 'paragraph' && parent && index !== undefined) {
        applyFigure(node, index, parent)
      } else if (node.type === 'heading') {
        applySectionNumber(node)
      }
      return undefined
    })
  }
}
