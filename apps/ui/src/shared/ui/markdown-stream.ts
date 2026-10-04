/**
 * Streaming-tail markdown stabilization.
 *
 * While a reply streams, the accumulated markdown frequently ends mid-construct:
 * an unterminated ``` fence renders the partial code as raw text, a dangling
 * `**` or backtick shows literal markers, a half-typed `[link](url` shows raw
 * syntax — and each of these "pops" into its formatted form a few frames later
 * once the model closes it. `closePartialMarkdown` conservatively completes
 * (or hides) those trailing constructs so the streamed view stays visually
 * stable. It is applied ONLY while streaming; the final text renders verbatim.
 */
import { isLiteralDollar } from './markdown-dollars'
import { isEscaped } from './markdown-prose'

const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/

/**
 * The fence the text is currently inside — its marker (e.g. "```") and where its body starts —
 * or null when all fenced code blocks are closed. A closing fence must use the same character,
 * be at least as long as the opener, and carry no info string.
 */
function openFence(text: string): { marker: string; bodyStart: number } | null {
  let open: { marker: string; bodyStart: number } | null = null
  let offset = 0
  for (const line of text.split('\n')) {
    const lineEnd = offset + line.length + 1
    const m = FENCE_LINE_RE.exec(line)
    if (m) {
      if (open === null) {
        open = { marker: m[1], bodyStart: Math.min(lineEnd, text.length) }
      } else if (
        m[1][0] === open.marker[0] &&
        m[1].length >= open.marker.length &&
        m[2].trim() === ''
      ) {
        open = null
      }
    }
    offset = lineEnd
  }
  return open
}

/**
 * The body of the fence a streaming text ends inside, or null when every fence is closed.
 *
 * Only the LAST fence can be unterminated, so this is how a renderer tells the one block that is
 * still being written from the finished blocks above it — a diagram above the tail is complete
 * and can be drawn now, instead of waiting for the whole reply to settle.
 */
export function openFenceBody(text: string): string | null {
  const fence = openFence(text)
  return fence ? text.slice(fence.bodyStart) : null
}

/** A trailing half-written image (`![alt](partial-url` or `![alt`) is hidden — a
 * broken-image flash is worse than a beat of nothing. */
function dropTrailingPartialImage(tail: string): string {
  return tail.replace(/!\[[^\]]*(\]\([^)]*)?$/, '')
}

/** A trailing `[text](partial-url` gets its `)` so the anchor text renders as a
 * link immediately instead of flashing raw syntax until the URL completes. */
function closeTrailingLink(tail: string): string {
  return /(^|[^!])\[[^\]]*\]\([^)]*$/.test(tail) ? `${tail})` : tail
}

/**
 * Code spans and CLOSED formulas blanked to spaces, positions kept. Emphasis has no meaning
 * inside either, and the balancers below would otherwise read `$a*b$` or `$x_i$` as an open
 * emphasis and append a stray `*` or `_` to the streaming tail.
 */
function maskInert(tail: string): string {
  const blank = (span: string) => ' '.repeat(span.length)
  return tail.replace(/`[^`]*`/g, blank).replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, blank)
}

/**
 * A formula still being typed is withheld from its opening `$` until the closing one arrives.
 * Math is typeset while a reply streams, so a half-typed `$\frac{a}{` would otherwise print as
 * raw LaTeX and then jump into a formula. A dollar that is not a delimiter — a currency amount,
 * a shell variable — is not counted: that call is `isLiteralDollar`, the same rule the renderer
 * escapes by, so the two can never disagree about one `$`.
 */
function withholdPartialMath(tail: string): string {
  const code = tail.replace(/`[^`]*`/g, (span) => ' '.repeat(span.length))
  const displays: number[] = []
  for (let index = code.indexOf('$$'); index !== -1; index = code.indexOf('$$', index + 2)) {
    if (!isEscaped(code, index)) displays.push(index)
  }
  if (displays.length % 2 === 1) return tail.slice(0, displays.at(-1)).trimEnd()

  const inline = code.replace(/\$\$[\s\S]*?\$\$/g, (span) => ' '.repeat(span.length))
  const delimiters: number[] = []
  for (let index = 0; index < inline.length; index += 1) {
    if (inline[index] === '$' && !isEscaped(inline, index) && !isLiteralDollar(inline, index)) {
      delimiters.push(index)
    }
  }
  if (delimiters.length % 2 === 0) return tail
  return tail.slice(0, delimiters.at(-1)).trimEnd()
}

/** Balance inline code: an odd number of backticks means an open span. A bare
 * trailing opener is stripped (closing it would render an empty span as
 * literal ``` `` ```); an opener with content gets closed. */
function balanceInlineCode(tail: string): string {
  const count = (tail.replace(/\\`/g, '').match(/`/g) ?? []).length
  if (count % 2 === 0) return tail
  return tail.endsWith('`') ? tail.slice(0, -1) : `${tail}\``
}

/** Balance a two-char emphasis delimiter (`**` / `~~`). Occurrences inside
 * inline code spans are ignored. A bare trailing opener is stripped (closing
 * an empty pair would render four literal characters); one with content after
 * it gets closed. */
function balanceDoubleDelimiter(tail: string, delim: string): string {
  const stripped = maskInert(tail)
  let count = 0
  for (let i = 0; (i = stripped.indexOf(delim, i)) !== -1; i += delim.length) count += 1
  if (count % 2 === 0) return tail
  return tail.endsWith(delim) ? tail.slice(0, -delim.length) : `${tail}${delim}`
}

const WORD_RE = /\w/

/**
 * Balance a single-char emphasis delimiter (`*` or `_`) — the most common
 * mid-stream flash after `**`: `*italic` shows the literal `*` until the model
 * closes it, then pops into italics. We append the missing closer so it renders
 * as emphasis immediately.
 *
 * The danger is false positives — a wrongly appended `*`/`_` italicises text the
 * author never marked up. So we count ONLY "emphasis-capable" lone delimiters:
 *   - runs of length ≥ 2 are skipped (they belong to `**`/`__`/`~~` handling);
 *   - inside inline code is masked out;
 *   - `*` counts only when it touches a word char on one side — excludes globs
 *     (`*.ts`), multiplication (`a * b`) and bullets (`* item`), where the `*` is
 *     flanked by whitespace/punctuation;
 *   - `_` additionally requires the word char to be on the OPENING side only —
 *     so intraword underscores (`file_name`, `__init__`, `snake_case`) never
 *     count, matching CommonMark's "no intraword `_` emphasis" rule.
 * An odd active count ⇒ a trailing opener is dangling: append one closer (or
 * strip a bare trailing opener, mirroring the double-delimiter rule).
 */
function balanceSingleEmphasis(tail: string, char: '*' | '_'): string {
  const masked = maskInert(tail)
  let active = 0
  let i = 0
  while (i < masked.length) {
    if (masked[i] !== char) {
      i += 1
      continue
    }
    let j = i
    while (j < masked.length && masked[j] === char) j += 1
    if (j - i === 1) {
      const prevWord = WORD_RE.test(masked[i - 1] ?? '')
      const nextWord = WORD_RE.test(masked[j] ?? '')
      const counts =
        char === '*' ? prevWord || nextWord : (!prevWord && nextWord) || (prevWord && !nextWord)
      if (counts) active += 1
    }
    i = j
  }
  if (active % 2 === 0) return tail
  return tail.endsWith(char) ? tail.slice(0, -1) : `${tail}${char}`
}

/** Hide only a partial row of an already established GFM table. A line starting
 * with `|` outside a table may be ordinary prose and must remain visible. */
function dropTrailingPartialTableRow(text: string): string {
  if (text.endsWith('\n')) return text
  const nl = text.lastIndexOf('\n')
  const lastLine = text.slice(nl + 1)
  if (nl === -1 || !/^\s{0,3}\|/.test(lastLine)) return text

  const preceding = text.slice(0, nl).split('\n')
  for (let i = preceding.length - 1; i >= 1; i -= 1) {
    const line = preceding[i]!.trim().replace(/^\|/, '').replace(/\|$/, '')
    const cells = line.split('|')
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) {
      return /^\s{0,3}\|/.test(preceding[i - 1]!) ? text.slice(0, nl) : text
    }
    if (!/^\s{0,3}\|/.test(preceding[i]!)) break
  }
  return text
}

/**
 * A quote line that is still typing its callout marker (`> [`, `> [!`, `> [!WARN`) is hidden
 * until the `]` arrives: it would otherwise print as a grey quote reading "[!WARN" and a beat
 * later turn into a note. A complete marker is kept — it already renders as the empty note.
 */
function dropTrailingPartialCalloutMarker(text: string): string {
  const nl = text.lastIndexOf('\n')
  const lastLine = text.slice(nl + 1)
  if (!/^\s{0,3}>[ \t]?\[(?:!\w*)?$/.test(lastLine)) return text
  return nl === -1 ? '' : text.slice(0, nl)
}

export function closePartialMarkdown(text: string): string {
  if (!text) return text

  // Inside an unterminated fence: close it and skip inline fixes — everything
  // after the opener is code, where emphasis/link syntax has no meaning.
  const fence = openFence(text)
  if (fence) return `${text}${text.endsWith('\n') ? '' : '\n'}${fence.marker}`

  // A half-typed table row is its own kind of flash — hide it. The active edit
  // is that row, so there's nothing else to stabilize this frame.
  const detabled = dropTrailingPartialTableRow(text)
  if (detabled !== text) return detabled
  // Same for a callout marker still being typed on its quote line.
  const unmarked = dropTrailingPartialCalloutMarker(text)
  if (unmarked !== text) return unmarked

  // Inline constructs cannot span a blank line, so only the last paragraph can
  // be dangling — operate on it alone and keep the rest byte-identical.
  const splitAt = text.lastIndexOf('\n\n')
  const head = splitAt === -1 ? '' : text.slice(0, splitAt + 2)
  let tail = splitAt === -1 ? text : text.slice(splitAt + 2)
  if (!tail) return text

  tail = dropTrailingPartialImage(tail)
  tail = withholdPartialMath(tail)
  tail = closeTrailingLink(tail)
  tail = balanceInlineCode(tail)
  tail = balanceDoubleDelimiter(tail, '**')
  tail = balanceDoubleDelimiter(tail, '~~')
  tail = balanceSingleEmphasis(tail, '*')
  tail = balanceSingleEmphasis(tail, '_')
  return head + tail
}
