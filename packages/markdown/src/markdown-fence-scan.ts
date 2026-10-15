/**
 * Incremental fenced-code scan for streaming markdown.
 *
 * A streaming reply is re-stabilized on every token, and every call has to know whether the text
 * ends inside an open fence. Rescanning the whole reply each time is quadratic in its length, so
 * the scan state after the last complete line is remembered and resumed when the next text extends
 * it. Any other text simply rescans from the start.
 */

export interface OpenFence {
  marker: string
  bodyStart: number
}

const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/

interface ScanState {
  /** Text through the end of the last complete line (ends with `\n`, or is empty). */
  prefix: string
  open: OpenFence | null
}

let cached: ScanState = { prefix: '', open: null }

/** The fence state after one line, given the state before it. */
function step(
  open: OpenFence | null,
  line: string,
  lineEnd: number,
  textLength: number,
): OpenFence | null {
  const m = FENCE_LINE_RE.exec(line)
  if (!m) return open
  if (open === null) return { marker: m[1]!, bodyStart: Math.min(lineEnd, textLength) }
  const closes =
    m[1]![0] === open.marker[0] && m[1]!.length >= open.marker.length && m[2]!.trim() === ''
  return closes ? null : open
}

/**
 * The fence the text is currently inside — its marker (e.g. "```") and where its body starts —
 * or null when all fenced code blocks are closed. A closing fence must use the same character,
 * be at least as long as the opener, and carry no info string.
 */
export function openFence(text: string): OpenFence | null {
  let { prefix, open } = cached
  if (!text.startsWith(prefix)) {
    prefix = ''
    open = null
  }
  let offset = prefix.length
  const lastNewline = text.lastIndexOf('\n')
  while (offset <= lastNewline) {
    const nl = text.indexOf('\n', offset)
    open = step(open, text.slice(offset, nl), nl + 1, text.length)
    offset = nl + 1
  }
  if (offset !== prefix.length) cached = { prefix: text.slice(0, offset), open }
  // The unterminated last line is evaluated but never committed: it may still change.
  return offset < text.length || lastNewline === -1
    ? step(open, text.slice(offset), text.length + 1, text.length)
    : open
}
