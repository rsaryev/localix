/**
 * Pure unified-diff → partial-patch construction for LINE-LEVEL staging.
 *
 * Given a single-file, FULL-CONTEXT unified diff (`git diff [--cached] -- <path>`)
 * and a set of selected change lines, build a minimal patch that contains ONLY the
 * selected additions/removals — the rest of the change is folded back into context
 * so `git apply` can still anchor the hunk. Applying that patch with
 * `git apply --cached` (or `--reverse`, `--reverse` on the worktree) stages /
 * unstages / discards exactly the selected lines.
 *
 * We keep FULL context (not `-U0`) on purpose: context lines give `git apply` a
 * reliable anchor, which is far more robust than hand-splicing zero-context hunks
 * by line number. All the delicate work — turning unselected changes into context,
 * dropping unselected additions, and recomputing each hunk's `@@` header — is pure
 * and unit-tested here; the git process wiring lives in `line-staging.ts`.
 *
 * Selection keys are the 0-based index of a line in the RAW diff text
 * (`diff.split('\n')`), so the value the client selects maps 1:1 to a diff line and
 * survives the round-trip. The same raw diff is re-read (and fingerprinted) at apply
 * time to guard against drift — see `line-staging.ts`.
 */

/** `@@ -oldStart[,oldCount] +newStart[,newCount] @@` — captures the four numbers. */
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** What a rendered diff line is, for the UI + the patch builder. */
export type DiffLineKind = 'hunk' | 'context' | 'add' | 'del'

/** One line of a parsed file diff (hunk header or body line), keyed by raw index. */
export interface ParsedDiffLine {
  /** 0-based index into the raw diff's line array — the stable selection key. */
  index: number
  kind: DiffLineKind
  /** Line text WITHOUT the leading `+`/`-`/space; for a `hunk` line the verbatim `@@ … @@`. */
  content: string
  /** 1-based line number in the OLD (pre-image) file — set for `context`/`del`. */
  oldNo?: number
  /** 1-based line number in the NEW (post-image) file — set for `context`/`add`. */
  newNo?: number
}

export interface ParsedFileDiff {
  /** Everything before the first `@@` — the `diff --git`/`index`/`---`/`+++` header. */
  header: string
  /** Hunk headers + body lines (the file header is NOT included), in order. */
  lines: ParsedDiffLine[]
}

interface RawHunk {
  /** Index of the `@@` header line in the raw diff array. */
  headerIndex: number
  oldStart: number
  newStart: number
  /** Body lines, each still carrying its `+`/`-`/` `/`\` prefix, with its raw index. */
  body: { index: number; text: string }[]
}

function parseRawHunks(rawLines: string[]): { headerEnd: number; hunks: RawHunk[] } {
  let headerEnd = rawLines.length
  const hunks: RawHunk[] = []
  let current: RawHunk | null = null
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]
    const m = HUNK_RE.exec(line)
    if (m) {
      if (hunks.length === 0) headerEnd = i
      current = { headerIndex: i, oldStart: Number(m[1]), newStart: Number(m[3]), body: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue // still in the file header
    // A blank final element from split('\n') (trailing newline) or a new `diff --git`
    // block terminates the current hunk body.
    if (line === '' && i === rawLines.length - 1) continue
    if (line.startsWith('diff --git')) {
      current = null
      continue
    }
    if (
      line.startsWith('+') ||
      line.startsWith('-') ||
      line.startsWith(' ') ||
      line.startsWith('\\')
    ) {
      current.body.push({ index: i, text: line })
    }
  }
  return { headerEnd, hunks }
}

/** Parse a single-file unified diff into its file header + indexed display lines. */
export function parseFileDiff(diff: string): ParsedFileDiff {
  const rawLines = diff.split('\n')
  const { headerEnd, hunks } = parseRawHunks(rawLines)
  const header = rawLines.slice(0, headerEnd).join('\n')
  const lines: ParsedDiffLine[] = []
  for (const hunk of hunks) {
    lines.push({ index: hunk.headerIndex, kind: 'hunk', content: rawLines[hunk.headerIndex] })
    let oldNo = hunk.oldStart
    let newNo = hunk.newStart
    for (const b of hunk.body) {
      if (b.text.startsWith('\\')) continue // "\ No newline at end of file" — structural, not shown
      if (b.text.startsWith('+')) {
        lines.push({ index: b.index, kind: 'add', content: b.text.slice(1), newNo })
        newNo++
      } else if (b.text.startsWith('-')) {
        lines.push({ index: b.index, kind: 'del', content: b.text.slice(1), oldNo })
        oldNo++
      } else {
        lines.push({ index: b.index, kind: 'context', content: b.text.slice(1), oldNo, newNo })
        oldNo++
        newNo++
      }
    }
  }
  return { header, lines }
}

const prefixOf = (line: string): DiffLineKind | 'newline' =>
  line.startsWith('+')
    ? 'add'
    : line.startsWith('-')
      ? 'del'
      : line.startsWith('\\')
        ? 'newline'
        : 'context'

/**
 * Transform one hunk's body to keep only the selected changes: unselected "old-file" lines
 * (deletions when staging, additions when
 * reverse-staging) become context; unselected "new-file" lines are dropped. Buffered
 * `pendingContext` preserves the `[selected old] [selected new] [context]` ordering
 * within a change block. Returns the rewritten body lines (each with prefix).
 */
function transformHunkBody(
  body: { index: number; text: string }[],
  selected: ReadonlySet<number>,
  reverse: boolean,
): string[] {
  const out: string[] = []
  let pending: string[] = []
  let sawUnselectedNewFile = false
  let skipNewlineAtIndex = -1
  const flush = () => {
    out.push(...pending)
    pending = []
  }
  for (const b of body) {
    const kind = prefixOf(b.text)
    if (kind === 'context') {
      flush()
      sawUnselectedNewFile = false
      out.push(b.text)
      continue
    }
    if (kind === 'newline') {
      if (b.index !== skipNewlineAtIndex) {
        flush()
        out.push(b.text)
      }
      continue
    }
    const isOldFileLine = (kind === 'del' && !reverse) || (kind === 'add' && reverse)
    if (selected.has(b.index)) {
      if (isOldFileLine || sawUnselectedNewFile) flush()
      out.push(b.text)
      continue
    }
    if (isOldFileLine) {
      // Unselected old-file line → context (present in the file git applies against).
      pending.push(' ' + b.text.slice(1))
      continue
    }
    // Unselected new-file line → dropped; also skip its trailing "\ No newline" marker.
    sawUnselectedNewFile = true
    skipNewlineAtIndex = b.index + 1
  }
  flush()
  return out
}

const countKind = (lines: string[], kinds: DiffLineKind[]) =>
  lines.filter((l) =>
    kinds.includes(prefixOf(l) === 'newline' ? 'context' : (prefixOf(l) as DiffLineKind)),
  ).length

/**
 * Build a partial patch containing only the selected change lines of `diff`.
 * Returns null when the selection yields no actual change (nothing to apply).
 *
 * `reverse` controls which side counts as "old file": false for staging (apply
 * `--cached`), true for unstaging / discarding (apply `--reverse`).
 */
export function buildLinePatch(
  diff: string,
  selected: ReadonlySet<number>,
  opts: { reverse: boolean },
): string | null {
  const rawLines = diff.split('\n')
  const { headerEnd, hunks } = parseRawHunks(rawLines)
  if (hunks.length === 0) return null
  const header = rawLines.slice(0, headerEnd).join('\n')

  const outHunks: string[] = []
  let startOffset = 0
  for (const hunk of hunks) {
    const newBody = transformHunkBody(hunk.body, selected, opts.reverse)
    const hasChange = newBody.some((l) => l.startsWith('+') || l.startsWith('-'))
    if (!hasChange) continue
    // "\ No newline" markers don't count toward either side's length.
    const bodyForCount = newBody.filter((l) => !l.startsWith('\\'))
    const oldLength = countKind(bodyForCount, ['context', 'del'])
    const newLength = countKind(bodyForCount, ['context', 'add'])
    const adjust = oldLength === 0 ? 1 : newLength === 0 ? -1 : 0
    const newStart = hunk.oldStart + startOffset + adjust
    startOffset += newLength - oldLength
    const headerLine = `@@ -${hunk.oldStart},${oldLength} +${newStart},${newLength} @@`
    outHunks.push([headerLine, ...newBody].join('\n'))
  }
  if (outHunks.length === 0) return null
  return `${header}\n${outHunks.join('\n')}\n`
}
