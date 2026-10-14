import type { Pluggable, PluggableList } from 'unified'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { remarkAnswerBlocks } from './remarkAnswerBlocks'
import { loadOnce } from '@localixai/kit/lib'
import { visit } from 'unist-util-visit'
import type { Element as HastElement, Root as HastRoot } from 'hast'

// GFM syntax is part of the message grammar, including while it streams. Disabling
// it mid-stream turns completed tables into literal pipes until the run ends. The answer
// blocks (callouts, quote sources, figures) are the same kind of grammar: a callout that only
// appeared after the run would re-flow the whole message at the moment it settles.
const remarkPluginsBase = [remarkGfm, remarkAnswerBlocks]
export { remarkGfm }

// Math is expensive AND rare: the remark-math + KaTeX pipeline (~280KB JS + CSS)
// is lazy-loaded the first time a message actually contains a `$` delimiter, so
// the overwhelmingly common (no-math) case never ships it in the chat chunk. The
// loaded plugins are cached module-wide, so only the first math render pays the
// async hop (a one-frame plain-text→rendered swap on that message). The typesetter
// is `rehypeMathCached`, which reuses every formula it already set — what makes it
// affordable to typeset while a reply is still streaming.
type MathPlugins = { remarkMath: Pluggable; rehypeKatex: Pluggable }
let mathPlugins: MathPlugins | null = null

/** True once the lazy KaTeX pipeline has been loaded module-wide. */
export function mathPluginsReady(): boolean {
  return mathPlugins != null
}

/**
 * Load the math pipeline once. A failed load is not remembered (`loadOnce`): a cached rejection
 * left every formula in the session as raw `$…$` source until a full reload.
 */
export const loadMathPlugins = loadOnce(async () => {
  const [rm, rk] = await Promise.all([
    import('remark-math'),
    import('./rehypeMathCached'),
    import('katex/dist/katex.min.css'),
  ])
  mathPlugins = { remarkMath: rm.default as Pluggable, rehypeKatex: rk.default as Pluggable }
})

/** Keep the base grammar identical for live and settled messages; defer only math. */
export function remarkPluginsFor(mathActive: boolean): PluggableList {
  const plugins: PluggableList = [...remarkPluginsBase]
  if (mathActive && mathPlugins) plugins.push(mathPlugins.remarkMath)
  return plugins
}

// Embedded raw HTML (READMEs with <p align>, <img> badges, <div>, …) is parsed
// by rehype-raw then XSS-sanitized — this content can come from the model or
// arbitrary files, so script/style/event-handler attrs are stripped. The schema
// extends GitHub's defaults to keep the presentational bits a README relies on
// (alignment, image sizing, link targets).
//
// The answer dialect's own nodes pass too (`remarkAnswerBlocks`, `remarkAnswerContainers`): they
// are made by our remark pass, not by the content, but the sanitizer runs after it and cannot tell
// — so a reply that ALSO carried an HTML tag lost every callout, timeline and tab set to plain
// quotes and lists. Only our names: `lx-` classes, the forms' data attributes, the tab elements.
const ANSWER_CLASS = /^lx-/
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'div',
    'span',
    'picture',
    'source',
    'aside',
    'figure',
    'figcaption',
    'footer',
    'answer-tabs',
    'answer-tab',
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] ?? []),
      'align',
      'width',
      'height',
      ['className', ANSWER_CLASS],
      'dataCallout',
      'dataCalloutTitle',
      'dataVerdict',
      'dataLabel',
    ],
    a: [...(defaultSchema.attributes?.a ?? []), 'target', 'rel'],
    img: [...(defaultSchema.attributes?.img ?? []), 'width', 'height', 'align'],
    source: ['srcSet', 'srcset', 'media', 'type'],
    // GitHub's schema names `className` for these three itself (the task-list classes), which
    // overrides the `*` rule above — so ours are added to theirs, not left to the wildcard.
    ...Object.fromEntries(
      (['ol', 'ul', 'li'] as const).map((tag) => [
        tag,
        [
          ...(defaultSchema.attributes?.[tag] ?? []).filter(
            (rule) => !(Array.isArray(rule) && rule[0] === 'className'),
          ),
          ['className', 'contains-task-list', 'task-list-item', ANSWER_CLASS],
        ],
      ]),
    ),
  },
}

/**
 * Key every GFM task box by WHERE its item sits in the source — what `MarkdownTaskList` stores a
 * tick under. The box itself is generated with no source position; its list item has one.
 */
export function rehypeTaskKeys() {
  const isBox = (node: HastElement['children'][number]): node is HastElement =>
    node.type === 'element' && node.tagName === 'input' && node.properties?.type === 'checkbox'
  return (tree: HastRoot) => {
    visit(tree, 'element', (item: HastElement) => {
      const offset = item.position?.start.offset
      if (item.tagName !== 'li' || offset === undefined) return
      // A tight item holds its box directly; a loose one inside its first paragraph.
      const first = item.children.find((child) => child.type === 'element')
      const box =
        item.children.find(isBox) ??
        (first?.type === 'element' && first.tagName === 'p'
          ? first.children.find(isBox)
          : undefined)
      if (box) box.properties = { ...box.properties, dataTaskKey: offset }
    })
  }
}

/**
 * rehype plugin selection. Base = none. HTML and math are each opt-in by content
 * sniffing so the common (plain-prose) case skips both pipelines. When HTML is
 * present: rehype-raw → rehype-sanitize (raw must be parsed before it's cleaned);
 * katex runs last so its trusted generated DOM isn't sanitized away.
 */
export function rehypePluginsFor(
  hasHtml: boolean,
  mathActive: boolean,
  beforeMath?: Pluggable,
): PluggableList {
  const plugins: PluggableList = []
  if (hasHtml) plugins.push(rehypeRaw, [rehypeSanitize, sanitizeSchema])
  // After the sanitizer, which does not know this attribute; task boxes are rare and the walk cheap.
  plugins.push(rehypeTaskKeys)
  if (beforeMath) plugins.push(beforeMath)
  if (mathActive && mathPlugins) plugins.push(mathPlugins.rehypeKatex)
  return plugins
}
