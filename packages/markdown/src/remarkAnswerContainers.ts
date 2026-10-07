// remark: the answer dialect's CONTAINER forms (`./dialect`) — a quote
// opened by `[!STEPS]`, `[!TABS]`, `[!STATS]`, `[!PROS]` or `[!CONS]` over ordinary Markdown.
//
//   steps        the quote gives way to its list, classed as a timeline; each item split into a
//                head (bold title + italic "when") and its text
//   tabs         `#### Label` sections become one `answer-tab` each inside an `answer-tabs`, which
//                the renderer draws as tabs (`AnswerVariants.tsx`)
//   stats        the list becomes a row of figures: `**value**` and its label
//   pros / cons  an aside with a list of points; a `pros` right before a `cons` (or the other way
//                round) is paired into one two-column block
//
// Everything stays in mdast `data.hName`/`hProperties` — no raw HTML — and a container the
// renderer already shaped carries an `hName`, which is how the block visitor knows to leave it
// alone instead of reading it again as a callout or a quote.
import type {
  Blockquote,
  BlockContent,
  DefinitionContent,
  ListItem,
  Paragraph,
  Parents,
  PhrasingContent,
} from 'mdast'
import { parseContainerMarker, type ContainerKind } from './dialect'

const meaningful = (children: PhrasingContent[]) =>
  children.filter((child) => !(child.type === 'text' && child.value.trim() === ''))

/** Separator text between a lead and what follows: ` — `, ` · `, `: ` or just a line break. */
const LEAD_SEPARATOR = /^[ \t]*(?:[—–·:|-][ \t]*)?(?:\n[ \t]*)?/

/** Drop leading separator text (and a hard break) off a phrasing run. */
function trimLead(nodes: PhrasingContent[]): PhrasingContent[] {
  const rest = [...nodes]
  while (rest[0]) {
    const lead = rest[0]
    if (lead.type === 'break') rest.shift()
    else if (lead.type === 'text') {
      const value = lead.value.replace(LEAD_SEPARATOR, '')
      if (value) {
        rest[0] = { ...lead, value }
        break
      }
      rest.shift()
    } else break
  }
  return rest
}

const classed = (className: string) => ({ hProperties: { className: [className] } })

/** A paragraph rendered as a `div`: in a TIGHT list remark-rehype unwraps a `p` into bare text. */
const block = (className: string, children: PhrasingContent[]): Paragraph => ({
  type: 'paragraph',
  data: { hName: 'div', ...classed(className) },
  children,
})

/** The container's title line, when the author wrote one after the marker. */
const titleLine = (className: string, title: string): Paragraph[] =>
  title
    ? [
        {
          type: 'paragraph',
          data: classed(className),
          children: [{ type: 'text', value: title }],
        },
      ]
    : []

/**
 * Split an item's first paragraph at its bold lead: the lead (and an emphasis right after it,
 * the "when") into a head, the rest into a body. Null when the item does not open with bold.
 */
function splitLead(
  item: ListItem,
): { lead: PhrasingContent; meta?: PhrasingContent; rest: PhrasingContent[] } | null {
  const first = item.children[0]
  if (first?.type !== 'paragraph') return null
  const [lead, ...after] = trimLead(first.children)
  if (lead?.type !== 'strong') return null
  let rest = trimLead(after)
  let meta: PhrasingContent | undefined
  if (rest[0]?.type === 'emphasis') {
    meta = rest[0]
    rest = trimLead(rest.slice(1))
  }
  return { lead, ...(meta ? { meta } : {}), rest }
}

/** One step: head (title + when) and body. An item without a bold title keeps its dot only. */
function shapeStep(item: ListItem): void {
  const split = splitLead(item)
  if (!split) return
  split.lead.data = { hName: 'span', ...classed('lx-step-title') }
  if (split.meta) split.meta.data = { hName: 'span', ...classed('lx-step-meta') }
  const head = block('lx-step-head', split.meta ? [split.lead, split.meta] : [split.lead])
  const body = meaningful(split.rest).length > 0 ? [block('lx-step-body', split.rest)] : []
  item.children.splice(0, 1, head, ...body)
}

/** One figure: its bold value and its label. An item without a bold value stays a plain line. */
function shapeStat(item: ListItem): void {
  const split = splitLead(item)
  if (!split) return
  split.lead.data = { hName: 'span', ...classed('lx-stat-value') }
  const label: PhrasingContent = {
    // `emphasis` only as a phrasing carrier: hName makes it the label's span.
    type: 'emphasis',
    data: { hName: 'span', ...classed('lx-stat-label') },
    children: split.meta ? [split.meta, ...split.rest] : split.rest,
  }
  item.children.splice(0, 1, block('lx-stat', [split.lead, label]))
}

/** The quote's content after its marker paragraph. */
type QuoteContent = Blockquote['children']

/** `[!TABS]`: each heading opens a tab, holding everything up to the next heading of its depth. */
function tabsOf(content: QuoteContent): Blockquote[] | null {
  const first = content[0]
  if (first?.type !== 'heading') return null
  const depth = first.depth
  const tabs: Blockquote[] = []
  for (const node of content) {
    if (node.type === 'heading' && node.depth === depth) {
      const label = labelText(node.children).trim()
      tabs.push({
        type: 'blockquote',
        data: { hName: 'answer-tab', hProperties: { dataLabel: label || `${tabs.length + 1}` } },
        children: [],
      })
    } else tabs.at(-1)!.children.push(node as BlockContent | DefinitionContent)
  }
  return tabs.length > 0 ? tabs : null
}

/** A bold/link/emphasis heading still has a name; formatting must not reduce it to "1". */
function labelText(nodes: PhrasingContent[]): string {
  return nodes
    .map((node): string => {
      if ('children' in node) return labelText(node.children)
      if ('value' in node) return node.value
      if (node.type === 'image' || node.type === 'imageReference') return node.alt ?? ''
      return ''
    })
    .join('')
}

function verdict(kind: 'pros' | 'cons', title: string, list: QuoteContent[number]): Blockquote {
  if (list.type === 'list') list.data = { ...list.data, ...classed('lx-verdict-list') }
  return {
    type: 'blockquote',
    data: { hName: 'aside', hProperties: { className: ['lx-verdict'], dataVerdict: kind } },
    children: [...titleLine('lx-verdict-title', title), list as BlockContent],
  }
}

const isVerdict = (node: Parents['children'][number] | undefined, kind: 'pros' | 'cons') =>
  node?.type === 'blockquote' &&
  (node.data?.hProperties as { dataVerdict?: string } | undefined)?.dataVerdict === kind

/** Each form's replacement nodes, or null when the content does not fit it (it stays a quote). */
function shape(kind: ContainerKind, title: string, content: QuoteContent): QuoteContent | null {
  const list = content[0]
  switch (kind) {
    case 'steps':
      if (list?.type !== 'list') return null
      list.data = { ...list.data, ...classed('lx-steps') }
      for (const item of list.children) shapeStep(item)
      return [...titleLine('lx-steps-title', title), list, ...content.slice(1)]
    case 'stats':
      if (list?.type !== 'list') return null
      list.data = { ...list.data, ...classed('lx-stats') }
      for (const item of list.children) shapeStat(item)
      return [...titleLine('lx-stats-title', title), list, ...content.slice(1)]
    case 'tabs': {
      const tabs = tabsOf(content)
      if (!tabs) return null
      return [
        ...titleLine('lx-tabs-title', title),
        {
          type: 'blockquote',
          data: { hName: 'answer-tabs' },
          children: tabs,
        },
      ]
    }
    case 'pros':
    case 'cons':
      if (list?.type !== 'list') return null
      return [verdict(kind, title, list), ...content.slice(1)]
  }
}

/**
 * The blocks a marker-only quote governs, read by grammar, not guessed: a list form takes the ONE
 * list right after it; tabs take the run of sections that starts with a heading right after it,
 * up to a shallower heading, a `---`, or the end of the reply. Anything else governs nothing.
 */
function following(kind: ContainerKind, siblings: Parents['children']): QuoteContent {
  const first = siblings[0]
  if (kind !== 'tabs') return first?.type === 'list' ? [first] : []
  if (first?.type !== 'heading') return []
  const run: QuoteContent = []
  for (const node of siblings) {
    if (node.type === 'thematicBreak') break
    if (node.type === 'heading' && node.depth < first.depth) break
    run.push(node as QuoteContent[number])
  }
  return run
}

/**
 * A container quote, shaped in place. True when it was one: the caller revisits the index, so
 * the nodes that replaced the quote are walked (and their figures and callouts shaped) too.
 */
export function applyContainer(quote: Blockquote, index: number, parent: Parents): boolean {
  const first = quote.children[0]
  const lead = first?.type === 'paragraph' ? first.children[0] : undefined
  if (lead?.type !== 'text' || first?.type !== 'paragraph' || first.children.length !== 1)
    return false
  const marker = parseContainerMarker(lead.value)
  if (!marker || lead.value.slice(marker.consumed).trim()) return false
  // A quote holding ONLY the marker takes the blocks right after it. That is how models write
  // these: `> [!TABS]` alone, then the headings unquoted — and Markdown ends a quote at a heading
  // or a list, so read literally the marker governed nothing and its content rendered as prose.
  const inside = quote.children.slice(1)
  const after = inside.length === 0 ? following(marker.kind, parent.children.slice(index + 1)) : []
  const nodes = shape(marker.kind, marker.title, inside.length > 0 ? inside : after)
  if (!nodes) return false
  // ONE node in the quote's place, spanning the form's whole source, marker included. A block's
  // actions copy their markdown by its position (`rehypeContentActions`), and the shaped list
  // kept only its own: `> [!STEPS]\n> 1. …\n> 2. …` was copied from `1.` on, so the board got
  // the first step bare, the rest still quoted and no marker — a broken list, not a timeline.
  const end = (after.at(-1) ?? quote).position?.end
  const position = quote.position && end ? { start: quote.position.start, end } : undefined
  const form: QuoteContent[number] =
    nodes.length === 1
      ? nodes[0]!
      : { type: 'blockquote', data: { hName: 'div', ...classed('lx-form') }, children: nodes }
  if (position) form.position = position
  parent.children.splice(index, 1 + after.length, form as Parents['children'][number])
  // A `pros` and a `cons` written one after the other are one decision: set them side by side.
  const other = marker.kind === 'pros' ? 'cons' : 'pros'
  const before = parent.children[index - 1]
  if ((marker.kind === 'pros' || marker.kind === 'cons') && isVerdict(before, other)) {
    const start = before?.position?.start
    const pair: Blockquote = {
      type: 'blockquote',
      data: { hName: 'div', ...classed('lx-verdicts') },
      children: [before as Blockquote, form as Blockquote],
      ...(start && position ? { position: { start, end: position.end } } : {}),
    }
    parent.children.splice(index - 1, 2, pair as Parents['children'][number])
  }
  return true
}

/** A node this module already shaped: the block visitor must not read it again. */
export const isShapedContainer = (quote: Blockquote) => Boolean(quote.data?.hName)
