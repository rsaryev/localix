/**
 * The light formatting a note or a shape label carries, read from its plain text.
 *
 * The text stays the store: a person types `**ship it**`, the agent writes the same, git diffs
 * it, and search matches it. Nothing here is a document model — a JSON tree would make every
 * note unreadable in the board file and to the agent, which is the board's first reader. So the
 * grammar is small and line-based, the part of Markdown people already type: headings, bullets,
 * numbers, task boxes and quotes per line, and inline marks within a line. A mark never spans
 * lines, so a half-typed marker can only ever spill within its own line.
 *
 * Pure, so the view, the copy-as-text path and the tests read text the same way.
 */
export type InlineMark = 'bold' | 'italic' | 'underline' | 'strike' | 'highlight' | 'code'

export interface InlineSpan {
  text: string
  marks: readonly InlineMark[]
}

export type RichBlock =
  | { kind: 'blank' }
  | { kind: 'paragraph'; spans: InlineSpan[] }
  | { kind: 'heading'; level: 1 | 2 | 3; spans: InlineSpan[] }
  | { kind: 'quote'; spans: InlineSpan[] }
  | { kind: 'bullet'; depth: number; spans: InlineSpan[] }
  | { kind: 'number'; depth: number; number: string; spans: InlineSpan[] }
  | { kind: 'task'; depth: number; checked: boolean; line: number; spans: InlineSpan[] }

interface MarkSyntax {
  mark: InlineMark
  token: string
  /** Its content is literal (code): no marks inside. */
  atomic?: boolean
  /** Only at word edges, so `snake_case_name` stays a name. */
  wordBound?: boolean
}

// Longer tokens first: `**` must win over `*` at the same position.
const SYNTAX: readonly MarkSyntax[] = [
  { mark: 'code', token: '`', atomic: true },
  { mark: 'bold', token: '**' },
  { mark: 'underline', token: '++' },
  { mark: 'strike', token: '~~' },
  { mark: 'highlight', token: '==' },
  { mark: 'italic', token: '*' },
  { mark: 'italic', token: '_', wordBound: true },
]
const ESCAPABLE = new Set(['\\', '`', '*', '_', '+', '~', '=', '#', '-', '>', '['])
const WORD = /[\p{L}\p{N}]/u

const space = (char: string | undefined) => char === undefined || /\s/u.test(char)

/** Where the closing token of `syntax` opened at `from` is, or -1. */
function closing(text: string, syntax: MarkSyntax, from: number): number {
  const { token } = syntax
  const start = from + token.length
  if (space(text[start])) return -1
  if (syntax.wordBound && WORD.test(text[from - 1] ?? '')) return -1
  for (let at = start + 1; at <= text.length - token.length; at++) {
    if (!text.startsWith(token, at) || space(text[at - 1])) continue
    // In a run longer than the token (`***`), the token closes at the run's END: the marker
    // before it belongs to a mark nested inside, as in `**bold *both***`.
    if (token.length > 1 && text[at + token.length] === token[0]) {
      let run = at + token.length
      while (text[run] === token[0]) run++
      return run - token.length
    }
    // A single `*` is not the first half of a `**`, nor the second.
    if (token === '*' && (text[at + 1] === '*' || text[at - 1] === '*')) continue
    if (syntax.wordBound && WORD.test(text[at + token.length] ?? '')) continue
    return at
  }
  return -1
}

export function parseInline(text: string, marks: readonly InlineMark[] = []): InlineSpan[] {
  const spans: InlineSpan[] = []
  let plain = ''
  const flush = () => {
    if (plain) spans.push({ text: plain, marks })
    plain = ''
  }
  let at = 0
  while (at < text.length) {
    const char = text[at]!
    if (char === '\\' && ESCAPABLE.has(text[at + 1] ?? '')) {
      plain += text[at + 1]
      at += 2
      continue
    }
    let syntax: MarkSyntax | undefined
    let end = -1
    for (const candidate of SYNTAX) {
      if (!text.startsWith(candidate.token, at) || marks.includes(candidate.mark)) continue
      end = closing(text, candidate, at)
      if (end >= 0) {
        syntax = candidate
        break
      }
    }
    if (!syntax) {
      plain += char
      at += 1
      continue
    }
    flush()
    const inner = text.slice(at + syntax.token.length, end)
    const nested = [...marks, syntax.mark]
    if (syntax.atomic) spans.push({ text: inner, marks: nested })
    else spans.push(...parseInline(inner, nested))
    at = end + syntax.token.length
  }
  flush()
  return spans
}

const HEADING = /^(#{1,3})\s+(.*)$/u
const QUOTE = /^>\s?(.*)$/u
const TASK = /^(\s*)[-*+]\s+\[([ xX])\]\s?(.*)$/u
const BULLET = /^(\s*)[-*+]\s+(.*)$/u
const NUMBER = /^(\s*)(\d{1,4}[.)])\s+(.*)$/u

/** Two spaces (or a tab) per nesting level. */
const depthOf = (indent: string) => Math.min(6, Math.floor(indent.replace(/\t/gu, '  ').length / 2))

export function parseRichText(text: string): RichBlock[] {
  return text.split('\n').map((line, index): RichBlock => {
    if (!line.trim()) return { kind: 'blank' }
    let match = HEADING.exec(line)
    if (match)
      return {
        kind: 'heading',
        level: match[1]!.length as 1 | 2 | 3,
        spans: parseInline(match[2]!),
      }
    if ((match = QUOTE.exec(line))) return { kind: 'quote', spans: parseInline(match[1]!) }
    if ((match = TASK.exec(line)))
      return {
        kind: 'task',
        depth: depthOf(match[1]!),
        checked: match[2] !== ' ',
        line: index,
        spans: parseInline(match[3]!),
      }
    if ((match = BULLET.exec(line)))
      return { kind: 'bullet', depth: depthOf(match[1]!), spans: parseInline(match[2]!) }
    if ((match = NUMBER.exec(line)))
      return {
        kind: 'number',
        depth: depthOf(match[1]!),
        number: match[2]!,
        spans: parseInline(match[3]!),
      }
    return { kind: 'paragraph', spans: parseInline(line) }
  })
}

/** The text with one task box ticked or cleared; anything else is returned unchanged. */
export function toggleTask(text: string, line: number): string {
  const lines = text.split('\n')
  const current = lines[line]
  const match = current === undefined ? null : TASK.exec(current)
  if (!match || current === undefined) return text
  const box = current.indexOf('[', match[1]!.length)
  lines[line] =
    `${current.slice(0, box + 1)}${match[2] === ' ' ? 'x' : ' '}${current.slice(box + 2)}`
  return lines.join('\n')
}

/** What the text says without its markers: for a label that must be one plain line. */
export function plainText(text: string): string {
  return parseRichText(text)
    .map((block) => ('spans' in block ? block.spans.map((span) => span.text).join('') : ''))
    .join('\n')
}
