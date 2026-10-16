// Pure detection of file-path links in a single line of terminal output.
//
// Agents in this IDE spend most of their time watching build / test / lint
// output stream into a terminal — tsc, eslint, vitest, ripgrep, python
// tracebacks, cargo, go. Every one of those prints `path:line[:col]` (or a
// close variant). Turning those into clickable links that jump straight to the
// source in the editor grid is the single biggest terminal win for this
// product, so this parser is deliberately broad about the common formats while
// staying high-precision. A ROOTED path (`/…`, `~/…`, `./…`, `../…`) links
// whole even when its final segment is a directory or extensionless file
// (`/Users/x/workspace/LOCALIX-795`); an UNROOTED path must carry a separator
// AND an extension, so prose like `and/or` or `24/7` is never linkified.
//
// This module is DOM- and xterm-free on purpose: it takes a string and returns
// character-offset ranges, so it can be unit-tested exhaustively. The
// TerminalPane adapter maps these ranges onto xterm buffer coordinates and
// wires the click to `inspector.openFile` (which resolves a workspace-relative
// path against the cwd of the terminal's own session, exactly like the file tree).

export interface FileLinkMatch {
  /** 0-based inclusive start offset into the source line. */
  startIndex: number
  /** 0-based exclusive end offset into the source line. */
  endIndex: number
  /** The raw matched text (what gets underlined). */
  text: string
  /** The file path portion (may be relative — resolved downstream). */
  path: string
  /** 1-based line, when the output carried one. */
  line?: number
  /** 1-based column, when the output carried one. */
  column?: number
}

// Building blocks for a file-path token. Windows drive prefixes (`C:\`) are
// intentionally out of scope — this is a macOS/Linux product.
//
// A path segment: word chars plus the few punctuation chars that appear in real
// filenames. `ROOT` is one of the four path roots we recognise.
const SEG = String.raw`[\w.@+-]+`
const ROOT = String.raw`(?:~\/|\.\.?\/|\/)`
// A final segment that may start with a dot (hidden files/dirs like `.bashrc`)
// but must NOT end on one — so a path at the end of a sentence
// (`/Users/x/dir.`) doesn't swallow the closing period.
const SEG_LAST = String.raw`[\w.@+-]*[\w@+-]`
//
// PATH is three alternatives, ordered most-specific first:
//  1. ROOTED — a path that starts with a real root (`/`, `~/`, `./`, `../`).
//     Its final segment need NOT carry an extension, so directories
//     (`/a/b/workspace/LOCALIX-795`) and extensionless files (`./Makefile.`->
//     `./Makefile`) linkify. Guarded by a lookbehind so the root can't be
//     glued to a preceding segment char: a mid-word slash (`and/or`, `24/7`)
//     is NOT a root, and the `//` in a URL / `scheme://` can't seed a spurious
//     `/host/path` match. Together with the URL-overlap check in
//     detectFileLinks this keeps URLs whole and prose un-linkified.
//  2. UNROOTED_DIR — an unrooted path WITH a separator AND an extension
//     (`src/foo.ts`). The extension requirement is what keeps prose like
//     `and/or` or `24/7` from linkifying.
//  3. UNROOTED_FILE — a bare filename WITH an extension (`foo.ts`), so
//     `foo.ts:42` still links. Only reachable via the `:line`/paren patterns.
const ROOTED = String.raw`(?<![\w.@+/:-])${ROOT}(?:${SEG}\/)*${SEG_LAST}`
const UNROOTED_DIR = String.raw`(?:${SEG}\/)+[\w.@+-]*\.\w{1,8}`
const UNROOTED_FILE = String.raw`[\w.@+-]*\.\w{1,8}`
const PATH = `${ROOTED}|${UNROOTED_DIR}|${UNROOTED_FILE}`

// Ordered by precedence. Each alternative captures `path`, and optionally
// `line` / `col`. The first pattern to claim a character range wins; later
// overlapping matches are dropped, so the richer `path:line:col` beats a bare
// path at the same spot.
// `path` is the capture-group index of the file path (0 = use the whole match).
const PATTERNS: { re: RegExp; path: number; line?: number; col?: number }[] = [
  // Python traceback:  File "foo/bar.py", line 42
  { re: new RegExp(String.raw`File "(${PATH})", line (\d+)`, 'g'), path: 1, line: 2 },
  // path:339 · path:339:12   (tsc, eslint, gcc, ripgrep, node stacks)
  { re: new RegExp(String.raw`(${PATH}):(\d+)(?::(\d+))?`, 'g'), path: 1, line: 2, col: 3 },
  // path(339) · path(339,12) · path[339,12]   (MSBuild, some TS/C# tools)
  {
    re: new RegExp(String.raw`(${PATH})[([](\d+)(?:,\s*(\d+))?[)\]]`, 'g'),
    path: 1,
    line: 2,
    col: 3,
  },
  // Bare path (no line info) — e.g. "wrote src/a.ts" or "cd /Users/x/workspace".
  // A ROOTED path may be extensionless (a directory); an UNROOTED one still
  // requires a slash + extension so we don't linkify every "foo.bar" in prose.
  { re: new RegExp(String.raw`${ROOTED}|${UNROOTED_DIR}`, 'g'), path: 0 },
]

/**
 * Extract file links from one line of terminal text. Returns non-overlapping
 * matches sorted by start offset, higher-precedence formats winning ties.
 */
export function detectFileLinks(text: string): FileLinkMatch[] {
  if (!text || text.length > 2000) return [] // guard pathological lines
  const claimed: FileLinkMatch[] = []
  // http(s) URLs win outright: a rooted path can match a URL's innards
  // (`//host/path`), so drop any file match that lands inside a URL span and
  // let detectUrls linkify the whole thing.
  const urlRanges = detectUrls(text).map((u) => [u.startIndex, u.endIndex] as const)

  for (const pat of PATTERNS) {
    pat.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = pat.re.exec(text)) !== null) {
      if (m[0].length === 0) {
        pat.re.lastIndex++
        continue
      }
      const path = pat.path === 0 ? m[0] : m[pat.path]
      const lineStr = pat.line ? m[pat.line] : undefined
      const colStr = pat.col ? m[pat.col] : undefined
      // Where the whole link starts: for the Python form the match begins with
      // `File "`, so anchor the link on the path itself, not the prefix.
      const pathOffset = m[0].indexOf(path)
      const startIndex = m.index + Math.max(0, pathOffset)
      const endIndex = m.index + m[0].length
      if (overlapsClaimed(claimed, startIndex, endIndex)) continue
      if (urlRanges.some(([s, e]) => startIndex < e && endIndex > s)) continue
      claimed.push({
        startIndex,
        endIndex,
        text: text.slice(startIndex, endIndex),
        path,
        line: lineStr ? Number(lineStr) : undefined,
        column: colStr ? Number(colStr) : undefined,
      })
    }
  }

  return claimed.sort((a, b) => a.startIndex - b.startIndex)
}

function overlapsClaimed(claimed: FileLinkMatch[], start: number, end: number): boolean {
  return claimed.some((c) => start < c.endIndex && end > c.startIndex)
}

export interface UrlLinkMatch {
  startIndex: number
  endIndex: number
  url: string
}

// http(s) URLs — the other thing agents constantly print (a dev-server URL, a
// docs link). Trailing punctuation that is almost never part of a URL (a period
// ending a sentence, a closing paren/bracket, a comma) is trimmed off.
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/g

/** Extract http(s) URLs from one line of terminal text. */
export function detectUrls(text: string): UrlLinkMatch[] {
  if (!text || text.length > 2000) return []
  const out: UrlLinkMatch[] = []
  let m: RegExpExecArray | null
  URL_RE.lastIndex = 0
  while ((m = URL_RE.exec(text)) !== null) {
    // Strip trailing sentence punctuation not meant to be part of the link.
    const trimmed = m[0].replace(/[.,;:!?)\]}'"]+$/, '')
    out.push({ startIndex: m.index, endIndex: m.index + trimmed.length, url: trimmed })
  }
  return out
}

// A single link surfaced by the keyboard link quickpick (⌘/Ctrl+⇧+O). Same two
// families as the click-to-open provider (file:line and http(s) URL), but
// flattened across the whole buffer and deduped so the picker shows each target
// once.
export type TerminalLinkItem =
  | { kind: 'file'; label: string; path: string; line?: number; column?: number }
  | { kind: 'url'; label: string; url: string }

/**
 * Gather every distinct link from a terminal's rendered lines, most-recent
 * first (the freshest error/URL sorts to the top of the picker). `lines` is the
 * buffer top-to-bottom; we walk it bottom-up and dedupe by target so a link
 * repeated across a scrolling log appears once. Bounded by `max` so a huge
 * scrollback stays cheap.
 */
export function collectTerminalLinks(lines: string[], max = 200): TerminalLinkItem[] {
  const items: TerminalLinkItem[] = []
  const seen = new Set<string>()
  for (let i = lines.length - 1; i >= 0 && items.length < max; i--) {
    const text = lines[i]
    if (!text) continue
    for (const f of detectFileLinks(text)) {
      const key = `f:${f.path}:${f.line ?? ''}:${f.column ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ kind: 'file', label: f.text, path: f.path, line: f.line, column: f.column })
      if (items.length >= max) break
    }
    for (const u of detectUrls(text)) {
      const key = `u:${u.url}`
      if (seen.has(key)) continue
      seen.add(key)
      items.push({ kind: 'url', label: u.url, url: u.url })
      if (items.length >= max) break
    }
  }
  return items
}

/** Case-insensitive substring filter over the visible label (empty → all). */
export function filterTerminalLinks(items: TerminalLinkItem[], query: string): TerminalLinkItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter((it) => it.label.toLowerCase().includes(q))
}
