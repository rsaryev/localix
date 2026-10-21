// Pure splitter that finds file-path-like tokens in plain tool output so the UI
// can render them as clickable links (grep results, stack traces, build errors).
// Kept separate from the component so the matching rules are unit-testable.

export interface TextSegment {
  /** The raw text of this segment, shown verbatim. */
  text: string
  /** UTF-16 offset in the source text; also a stable render identity. */
  start: number
  /** When set, the segment is a file path that should open in the inspector
   *  (the `:line[:col]` suffix is stripped off into `line`). */
  path?: string
  /** 1-indexed line parsed from a `path:line[:col]` token, for scroll-to-line. */
  line?: number
  /** When set, the segment is an http(s) URL to open in a new tab. */
  href?: string
}

// One pass over the text, matching EITHER an http(s) URL OR a file path. The URL
// alternative is first so `https://host/a.ts` is treated as a link, not a path.
// Path: require at least one `/` so prose like "e.g." / "v1.2" never matches —
// a dir segment, a filename with an extension, then an optional `:line[:col]`.
const URL_RE = String.raw`https?:\/\/[^\s<>()\[\]"']+`
const PATH_RE = String.raw`\/?(?:[\w.\-]+\/)+[\w.\-]+\.\w+(?::\d+(?::\d+)?)?`
const LINK_RE = new RegExp(`(${URL_RE})|(${PATH_RE})`, 'g')

// Trailing punctuation that almost always belongs to the surrounding prose, not
// the URL (e.g. "see https://x.com/p." or "(https://x.com)").
const stripTrailingPunct = (url: string) => url.replace(/[.,;:!?'")\]]+$/, '')

/** Split text into plain, file-path, and URL segments for inline linkification. */
export function splitLinkedPaths(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  const re = new RegExp(LINK_RE)
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), start: last })
    if (m[1]) {
      const href = stripTrailingPunct(m[1])
      segments.push({ text: href, href, start: m.index })
      // Re-emit any stripped trailing punctuation as plain text.
      if (href.length < m[1].length) {
        segments.push({ text: m[1].slice(href.length), start: m.index + href.length })
      }
    } else {
      const token = m[2]
      const lineMatch = token.match(/:(\d+)(?::\d+)?$/)
      segments.push({
        text: token,
        start: m.index,
        path: token.replace(/:\d+(?::\d+)?$/, ''),
        line: lineMatch ? Number.parseInt(lineMatch[1], 10) : undefined,
      })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) segments.push({ text: text.slice(last), start: last })
  return segments
}
