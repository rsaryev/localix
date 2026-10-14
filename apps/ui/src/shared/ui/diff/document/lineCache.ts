/**
 * Per-line render work, computed on first sight and remembered by line id.
 *
 * The old surfaces highlighted every line and word-diffed every modify pair up
 * front, then capped highlighting at 2,000 lines so a big diff would open at all —
 * which meant a big diff lost its colours entirely. Only mounted rows ask here, so
 * the work is proportional to what was actually scrolled past, and a 50k-line file
 * keeps syntax colours like a 50-line one.
 *
 * A line past `LONG_LINE_COLS` (minified bundles, data blobs) renders escaped and
 * without word marks: sugar-high and the word diff are both super-linear on one
 * enormous line, and a frame spent there is a frame the scroll drops.
 */
import { segmentLinePair, type IntralineSegment } from '../intralineDiff'
import { escapeDiffHtml } from '../DiffCode'
import { LONG_LINE_COLS, RENDER_LINE_CHARS, type DiffDocument } from './diffDocument'

export interface LineCache {
  html(id: number): string
  segments(id: number): IntralineSegment[] | null
  /** Characters beyond the mounted cap, for the row's "+N characters" marker. */
  hiddenChars(id: number): number
}

type Highlight = (text: string, language: string | undefined) => string

const NO_SEGMENTS: IntralineSegment[] = []

export function createLineCache(
  doc: DiffDocument,
  languageOf: (file: number) => string | undefined,
  highlight: Highlight,
): LineCache {
  // Sparse by design: only lines that were ever mounted get a slot.
  const html: (string | undefined)[] = []
  const segments: (IntralineSegment[] | undefined)[] = []
  const languages = new Map<number, string | undefined>()

  const language = (id: number) => {
    const file = doc.hunks[doc.lines[id]!.hunk]!.file
    if (!languages.has(file)) languages.set(file, languageOf(file))
    return languages.get(file)
  }

  const visible = (text: string) =>
    text.length > RENDER_LINE_CHARS ? text.slice(0, RENDER_LINE_CHARS) : text

  return {
    html(id) {
      const cached = html[id]
      if (cached !== undefined) return cached
      const line = doc.lines[id]!
      const text = visible(line.text)
      const out = line.cols > LONG_LINE_COLS ? escapeDiffHtml(text) : highlight(text, language(id))
      html[id] = out
      return out
    },
    segments(id) {
      const cached = segments[id]
      if (cached !== undefined) return cached === NO_SEGMENTS ? null : cached
      const line = doc.lines[id]!
      const partner = line.partner >= 0 ? doc.lines[line.partner]! : undefined
      if (!partner || line.cols > LONG_LINE_COLS || partner.cols > LONG_LINE_COLS) {
        segments[id] = NO_SEGMENTS
        return null
      }
      // Compute the pair once and fill both sides, so the partner row is free.
      const del = line.type === 'del' ? line : partner
      const add = line.type === 'del' ? partner : line
      const pair = segmentLinePair(del.text, add.text)
      const delId = line.type === 'del' ? id : line.partner
      const addId = line.type === 'del' ? line.partner : id
      segments[delId] = pair?.del ?? NO_SEGMENTS
      segments[addId] = pair?.add ?? NO_SEGMENTS
      const mine = segments[id]!
      return mine === NO_SEGMENTS ? null : mine
    },
    hiddenChars(id) {
      return Math.max(0, doc.lines[id]!.text.length - RENDER_LINE_CHARS)
    },
  }
}
