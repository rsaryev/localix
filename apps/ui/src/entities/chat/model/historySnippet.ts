export interface SnippetSegment {
  text: string
  /** True for the matched span (FTS5 wraps matches in `[ ]`). */
  match: boolean
}

/**
 * Parse an FTS5 `snippet()` result into highlight segments. FTS5 wraps each
 * matched term in `[ ]` (the open/close markers we passed); everything else is
 * plain context (with `…` ellipses). Pure → unit-tested.
 */
export function parseSnippet(snippet: string): SnippetSegment[] {
  const out: SnippetSegment[] = []
  const re = /\[([^\]]*)\]/g
  let last = 0
  for (let m = re.exec(snippet); m; m = re.exec(snippet)) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), match: false })
    out.push({ text: m[1], match: true })
    last = re.lastIndex
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), match: false })
  return out
}
