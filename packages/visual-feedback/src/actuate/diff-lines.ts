/**
 * Ordered line diff for the change report: the longest-common-subsequence diff of the page's
 * lines before and after an action, each change told after the unchanged line above it so that of
 * several equal lines (a game's zeros, a list's repeated rows) the one that changed is known by
 * its place. Ported from the desk's `changes.rs`.
 */

/** Lines of changes told at most; past them the page is read whole. */
export const MAX_CHANGES = 30

/** The most line pairs compared (an interactive outline is a few hundred lines); past it the page
 *  is read whole instead of spending a quadratic table. */
export const MAX_PAIRS = 4_000_000

/** One line of the diff: kept, gone (only before) or came (only after). `at` indexes the list the
 *  line is from — `before` for kept/gone, `after` for came — so a caller can map it back. */
export interface DiffLine {
  kind: 'kept' | 'gone' | 'came'
  text: string
  at: number
}

/** The LCS diff, gone lines before new ones; undefined past `MAX_PAIRS`. */
export function lcsDiff(old: string[], next: string[]): DiffLine[] | undefined {
  const n = old.length
  const m = next.length
  if (n * m > MAX_PAIRS) return undefined
  // common[i * width + j]: the longest common run of old[i..] and next[j..].
  const width = m + 1
  const common = new Uint16Array((n + 1) * width)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      common[i * width + j] =
        old[i] === next[j]
          ? common[(i + 1) * width + j + 1]! + 1
          : Math.max(common[(i + 1) * width + j]!, common[i * width + j + 1]!)
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && old[i] === next[j]) {
      lines.push({ kind: 'kept', text: next[j]!, at: j })
      i++
      j++
    } else if (j === m || (i < n && common[(i + 1) * width + j]! >= common[i * width + j + 1]!)) {
      lines.push({ kind: 'gone', text: old[i]!, at: i })
      i++
    } else {
      lines.push({ kind: 'came', text: next[j]!, at: j })
      j++
    }
  }
  return lines
}

/** The lines that tell the changes: each change after the kept line above it, `  …` over a gap. */
export function tellChanges(lines: DiffLine[], show: (line: DiffLine) => string): string[] {
  const out: string[] = []
  let shown = -1
  lines.forEach((line, at) => {
    if (line.kind === 'kept') return
    const above = lines[at - 1]
    const context = above?.kind === 'kept' && shown !== at - 1 ? at - 1 : undefined
    const first = context ?? at
    if (shown >= 0 && shown + 1 < first) out.push('  …')
    if (context !== undefined) out.push(`  ${show(above!)}`)
    out.push(`${line.kind === 'gone' ? '-' : '+'} ${show(line)}`)
    shown = at
  })
  return out
}
