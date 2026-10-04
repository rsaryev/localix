/**
 * Raw patch text → per-file hunk inputs, in ONE pass over the lines.
 *
 * The defect this replaces: a multi-file patch was first cut into per-file strings
 * (`splitMultiFilePatch`, joining every chunk back into a string), then each chunk
 * was re-split and re-parsed by `diff`'s `parsePatch`, which also rewrote every hunk
 * header and so dropped git's trailing function context (`@@ … @@ fn name`). On an
 * 8 MB commit that is three full copies of the text before a line renders.
 *
 * Hunk bodies are bounded by the header's own line counts, not by prefix sniffing:
 * a deleted line that reads `-- x` is `--- x` in the patch, and only the counts
 * tell it apart from the next file's `---` header. A header without counts (a V4A
 * `@@` marker, a mid-stream fragment) runs until the next `@@` or `diff --git`.
 */
import {
  buildDiffDocument,
  type DiffDocument,
  type DiffFileInput,
  type DiffHunkInput,
  type DiffLineInput,
} from './diffDocument'

/** Raw patch text straight to a renderable document. */
export function diffDocumentFromPatch(patch: string): DiffDocument {
  return buildDiffDocument(parsePatchText(patch))
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

interface OpenHunk {
  hunk: DiffHunkInput
  oldNo: number
  newNo: number
  /** Lines still owed by the header counts; `null` = unbounded (no counts). */
  oldLeft: number | null
  newLeft: number | null
}

function unquote(path: string): string {
  const trimmed = path.trim()
  return trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed
}

function stripSide(path: string): string {
  const clean = unquote(path).replace(/\t.*$/, '')
  return clean.startsWith('a/') || clean.startsWith('b/') ? clean.slice(2) : clean
}

function gitHeaderPath(line: string): string {
  // `diff --git a/x b/x` — the b-side is the post-image; ambiguous with spaces, so
  // it is only a fallback for a header-only (mode/binary) change.
  const match = /^diff --git (?:"?a\/.*?"?) "?b\/(.*?)"?$/.exec(line)
  return match?.[1] ?? ''
}

function newFile(path = ''): DiffFileInput {
  return { path, hunks: [] }
}

function bodyOpen(open: OpenHunk | null): open is OpenHunk {
  if (!open) return false
  if (open.oldLeft === null || open.newLeft === null) return true
  return open.oldLeft > 0 || open.newLeft > 0
}

/**
 * Parse a unified (optionally multi-file, git-flavoured) patch. A text with no
 * `@@` at all is typed line by line (`+`/`-`/context) as one anonymous hunk, so a
 * fragment still reads as a diff instead of nothing.
 */
export function parsePatchText(patch: string): DiffFileInput[] {
  const raw = patch.split('\n')
  if (raw.length > 0 && raw[raw.length - 1] === '') raw.pop()
  const files: DiffFileInput[] = []
  let file: DiffFileInput | null = null
  let open: OpenHunk | null = null
  let sawHunk = false

  const push = (line: DiffLineInput) => {
    open!.hunk.lines.push(line)
  }

  for (const line of raw) {
    if (bodyOpen(open) && !line.startsWith('diff --git ')) {
      const head = line[0]
      if (head === '\\') {
        push({ type: 'meta', text: line })
        continue
      }
      const bounded = open.oldLeft !== null
      if (head === '+' || head === '-' || head === ' ' || (line === '' && bounded)) {
        const text = line.slice(1)
        if (head === '+') {
          push({ type: 'add', text, newNo: open.newNo++ })
          if (bounded) open.newLeft!--
        } else if (head === '-') {
          push({ type: 'del', text, oldNo: open.oldNo++ })
          if (bounded) open.oldLeft!--
        } else {
          push({ type: 'ctx', text, oldNo: open.oldNo++, newNo: open.newNo++ })
          if (bounded) {
            open.oldLeft!--
            open.newLeft!--
          }
        }
        continue
      }
      if (!line.startsWith('@@')) {
        if (!bounded) {
          push({ type: 'ctx', text: line, oldNo: open.oldNo++, newNo: open.newNo++ })
          continue
        }
      }
    }
    // A `\ No newline` marker may trail the hunk after its counts are spent.
    if (open && line.startsWith('\\')) {
      push({ type: 'meta', text: line })
      continue
    }

    const hunkMatch = line.startsWith('@@') ? HUNK_RE.exec(line) : null
    if (line.startsWith('@@')) {
      if (!file) {
        file = newFile()
        files.push(file)
      }
      sawHunk = true
      const hunk: DiffHunkInput = { header: line, lines: [] }
      file.hunks.push(hunk)
      open = hunkMatch
        ? {
            hunk,
            oldNo: Number(hunkMatch[1]),
            newNo: Number(hunkMatch[3]),
            oldLeft: hunkMatch[2] === undefined ? 1 : Number(hunkMatch[2]),
            newLeft: hunkMatch[4] === undefined ? 1 : Number(hunkMatch[4]),
          }
        : { hunk, oldNo: 1, newNo: 1, oldLeft: null, newLeft: null }
      continue
    }
    open = null

    if (line.startsWith('diff --git ')) {
      file = newFile(gitHeaderPath(line))
      files.push(file)
      continue
    }
    if (line.startsWith('--- ')) {
      // A plain (non-git) multi-file patch starts its next file at `---`.
      if (!file || file.hunks.length > 0) {
        file = newFile()
        files.push(file)
      }
      const oldPath = unquote(line.slice(4))
      if (oldPath !== '/dev/null' && !file.path) file.path = stripSide(oldPath)
      if (oldPath === '/dev/null') file.added = true
      continue
    }
    if (!file) continue // preamble (format-patch cover text, commit header)
    if (line.startsWith('+++ ')) {
      const newPath = unquote(line.slice(4))
      if (newPath === '/dev/null') file.deleted = true
      else file.path = stripSide(newPath)
    } else if (line.startsWith('new file mode')) file.added = true
    else if (line.startsWith('deleted file mode')) file.deleted = true
    else if (line.startsWith('rename to ')) file.path = unquote(line.slice(10))
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.binary = true
  }

  if (!sawHunk) return fallbackFragment(raw, files)
  return files
}

/** No hunk anywhere: keep git's header-only files, or type a bare fragment line by line. */
function fallbackFragment(raw: string[], files: DiffFileInput[]): DiffFileInput[] {
  if (files.length > 0) return files
  if (raw.length === 0) return []
  let oldNo = 1
  let newNo = 1
  const lines = raw.map((line): DiffLineInput => {
    if (line.startsWith('+')) return { type: 'add', text: line.slice(1), newNo: newNo++ }
    if (line.startsWith('-')) return { type: 'del', text: line.slice(1), oldNo: oldNo++ }
    const text = line.startsWith(' ') ? line.slice(1) : line
    return { type: 'ctx', text, oldNo: oldNo++, newNo: newNo++ }
  })
  return [{ path: '', hunks: [{ header: '', lines }] }]
}
