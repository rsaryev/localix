// Shared DOM adapter that expands an arbitrary text selection inside a prose container to the full
// sentence(s) it touches. The DOM walking (offsets ↔ nodes, range re-apply) lives
// here; the locale-aware sentence math is the pure `./sentence-bounds` module.

import { sentenceBounds, expandToSentences } from './sentence-bounds'

/** Map a character offset within `root`'s text content to a DOM (node, offset) pair. */
function pointAt(root: Node, charOffset: number): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let acc = 0
  let last: Text | null = null
  let node = walker.nextNode() as Text | null
  while (node) {
    const len = node.data.length
    if (charOffset <= acc + len) return { node, offset: charOffset - acc }
    acc += len
    last = node
    node = walker.nextNode() as Text | null
  }
  return last ? { node: last, offset: last.data.length } : { node: root, offset: 0 }
}

/** Character offset of `node`+`offset` within `root`'s flattened text. */
function offsetOf(root: Node, node: Node, offset: number): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let acc = 0
  let n = walker.nextNode() as Text | null
  while (n) {
    if (n === node) return acc + offset
    acc += n.data.length
    n = walker.nextNode() as Text | null
  }
  return acc
}

/** Nearest block-level ancestor (paragraph/heading/li) so sentences don't bleed across blocks. */
function blockAncestor(node: Node | null, root: HTMLElement): HTMLElement {
  let el =
    (node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null)) ?? root
  const blocks = new Set([
    'P',
    'LI',
    'H1',
    'H2',
    'H3',
    'H4',
    'H5',
    'H6',
    'BLOCKQUOTE',
    'TD',
    'TH',
    'DD',
    'DT',
    'FIGCAPTION',
  ])
  while (el && el !== root && !blocks.has(el.tagName)) el = el.parentElement as HTMLElement
  return el && root.contains(el) ? el : root
}

/**
 * Locates `quote` inside `container` (tolerant of whitespace differences, since
 * stored quotes are whitespace-collapsed) and returns a DOM Range covering it,
 * or null if not found. `occurrence` picks the Nth match (0-based).
 */
export function findQuoteRange(
  container: HTMLElement,
  quote: string,
  occurrence = 0,
): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  // Raw flattened text + a map from raw char index → owning text node.
  const nodes: Array<{ node: Text; start: number }> = []
  let raw = ''
  let node = walker.nextNode() as Text | null
  while (node) {
    nodes.push({ node, start: raw.length })
    raw += node.data
    node = walker.nextNode() as Text | null
  }

  // Normalized text (collapsed whitespace) + map back to raw indices.
  let norm = ''
  const normToRaw: number[] = []
  let inWs = false
  for (let i = 0; i < raw.length; i++) {
    const ws = /\s/.test(raw[i])
    if (ws) {
      if (inWs) continue
      inWs = true
      norm += ' '
      normToRaw.push(i)
    } else {
      inWs = false
      norm += raw[i]
      normToRaw.push(i)
    }
  }
  const needle = quote.replace(/\s+/g, ' ').trim()
  if (!needle) return null

  let from = 0
  let found = -1
  for (let k = 0; k <= occurrence; k++) {
    found = norm.indexOf(needle, from)
    if (found === -1) return null
    from = found + 1
  }
  const rawStart = normToRaw[found]
  const rawEnd = (normToRaw[found + needle.length - 1] ?? raw.length - 1) + 1

  const locate = (rawIdx: number) => {
    let lo = 0
    let entry = nodes[0]
    for (const n of nodes) {
      if (n.start <= rawIdx) {
        entry = n
        lo = n.start
      } else break
    }
    return {
      node: entry.node,
      offset: Math.min(rawIdx - lo, entry.node.data.length),
    }
  }
  const a = locate(rawStart)
  const b = locate(rawEnd)
  const range = document.createRange()
  range.setStart(a.node, a.offset)
  range.setEnd(b.node, b.offset)
  return range
}

export interface ExpandedSelection {
  /** The sentence-expanded, trimmed text. */
  quote: string
  /** Viewport rect of the (re-selected) range, for anchoring the comment button. */
  rect: DOMRect
}

/**
 * Reads the live window selection; if it lies inside `container`, expands it to
 * cover whole sentences, re-applies it visually, and returns the quote + rect.
 * Returns null when there's no usable selection inside the container.
 */
export function expandSelectionToSentence(container: HTMLElement): ExpandedSelection | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null

  const range = sel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null

  const block = blockAncestor(range.startContainer, container)
  const text = block.textContent ?? ''
  if (!text.trim()) return null

  const selStart = offsetOf(block, range.startContainer, range.startOffset)
  const selEnd = offsetOf(block, range.endContainer, range.endOffset)

  const [start, end] = expandToSentences(text, sentenceBounds(text), selStart, selEnd)

  const quote = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (!quote) return null

  // Re-apply the expanded selection so the user sees the full-sentence highlight.
  const a = pointAt(block, start)
  const b = pointAt(block, end)
  const expanded = document.createRange()
  expanded.setStart(a.node, a.offset)
  expanded.setEnd(b.node, b.offset)
  sel.removeAllRanges()
  sel.addRange(expanded)

  return { quote, rect: expanded.getBoundingClientRect() }
}
