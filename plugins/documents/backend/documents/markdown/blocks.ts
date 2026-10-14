/**
 * Pure Markdown block parser. Turns a Markdown string into a flat list of {@link Block}s
 * — a pragmatic subset (headings, paragraphs, ordered/unordered lists, GFM pipe tables,
 * fenced code, block-quotes, horizontal rules) that the docx and pdf generators map to
 * their native primitives. No lib deps, no DOM. Anything unrecognised becomes a
 * paragraph, so the parser never throws and never drops content.
 */
import { parseInline, type InlineSpan } from './inline'

export type Block =
  | { type: 'heading'; level: number; spans: InlineSpan[] }
  | { type: 'paragraph'; spans: InlineSpan[] }
  | { type: 'list'; ordered: boolean; items: InlineSpan[][] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'code'; text: string; lang?: string }
  | { type: 'blockquote'; spans: InlineSpan[] }
  | { type: 'hr' }

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/
const FENCE_RE = /^\s*(`{3,}|~{3,})\s*(\S+)?\s*$/
const UL_RE = /^\s*[-*+]\s+(.*)$/
const OL_RE = /^\s*\d+[.)]\s+(.*)$/
const QUOTE_RE = /^\s*>\s?(.*)$/
/**
 * A table separator row: pipes + dashes + optional colons, e.g. `| --- | :--: |`.
 *
 * Each inner `\s*` is gated behind a required `|` (`(?:\|\s*)?`, `\s*\|\s*`) rather than
 * the tempting `\s*\|?\s*`: with the pipe optional, the two `\s*` there compete over the
 * same whitespace run, and on a non-matching line (`"   ----!"`) that backtracked
 * QUADRATICALLY — ~1.7s at 40k chars. Lines can be large/AI-generated, so this ran on the
 * hot per-line path. This form is unambiguous and linear, with identical matches.
 */
const TABLE_SEP_RE = /^\s*(?:\|\s*)?:?-+:?(?:\s*\|\s*:?-+:?)*\s*(?:\|\s*)?$/

/** Split a GFM pipe-table row into trimmed cells (tolerating optional edge pipes). */
function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}

/** True when `line` opens a pipe table (has a `|` and the next line is a separator). */
function isTableStart(line: string, next: string | undefined): boolean {
  return line.includes('|') && next != null && TABLE_SEP_RE.test(next) && next.includes('-')
}

/** Parse a Markdown string into a flat list of blocks. */
export function parseMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0

  const flushParagraph = (buf: string[]) => {
    if (buf.length === 0) return
    blocks.push({ type: 'paragraph', spans: parseInline(buf.join(' ').trim()) })
    buf.length = 0
  }

  const para: string[] = []

  while (i < lines.length) {
    const line = lines[i]

    // Blank line: paragraph boundary.
    if (line.trim() === '') {
      flushParagraph(para)
      i += 1
      continue
    }

    // Fenced code block.
    const fence = FENCE_RE.exec(line)
    if (fence) {
      flushParagraph(para)
      const marker = fence[1]
      const lang = fence[2]
      const body: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trimStart().startsWith(marker[0].repeat(3))) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // skip closing fence (or run off the end)
      blocks.push({ type: 'code', text: body.join('\n'), lang: lang || undefined })
      continue
    }

    // Heading.
    const heading = HEADING_RE.exec(line)
    if (heading) {
      flushParagraph(para)
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        spans: parseInline(heading[2].trim()),
      })
      i += 1
      continue
    }

    // Horizontal rule (checked before list markers so `---` isn't read as a bullet).
    if (HR_RE.test(line)) {
      flushParagraph(para)
      blocks.push({ type: 'hr' })
      i += 1
      continue
    }

    // Pipe table.
    if (isTableStart(line, lines[i + 1])) {
      flushParagraph(para)
      const header = splitTableRow(line)
      i += 2 // header + separator
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitTableRow(lines[i]))
        i += 1
      }
      blocks.push({ type: 'table', header, rows })
      continue
    }

    // List (ordered or unordered) — consume consecutive same-kind items.
    const ulMatch = UL_RE.exec(line)
    const olMatch = OL_RE.exec(line)
    if (ulMatch || olMatch) {
      flushParagraph(para)
      const ordered = Boolean(olMatch)
      const items: InlineSpan[][] = []
      while (i < lines.length) {
        const m = ordered ? OL_RE.exec(lines[i]) : UL_RE.exec(lines[i])
        if (!m) break
        items.push(parseInline(m[1].trim()))
        i += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // Block-quote — join consecutive quoted lines.
    const quote = QUOTE_RE.exec(line)
    if (quote) {
      flushParagraph(para)
      const buf: string[] = [quote[1]]
      i += 1
      while (i < lines.length) {
        const q = QUOTE_RE.exec(lines[i])
        if (!q) break
        buf.push(q[1])
        i += 1
      }
      blocks.push({ type: 'blockquote', spans: parseInline(buf.join(' ').trim()) })
      continue
    }

    // Plain text — accumulate into the current paragraph.
    para.push(line.trim())
    i += 1
  }

  flushParagraph(para)
  return blocks
}

/** Find the first pipe-table block in a Markdown string (backs xlsx-from-Markdown). */
export function firstTableBlock(markdown: string): Extract<Block, { type: 'table' }> | null {
  for (const block of parseMarkdownBlocks(markdown)) {
    if (block.type === 'table') return block
  }
  return null
}
