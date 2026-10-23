/**
 * Granular per-hunk change model + single-hunk revert for the git backend.
 *
 * A file's working change vs `HEAD` is read with ZERO context (`git diff -U0`),
 * which splits it into one hunk per contiguous change run — a 1:1 match with the
 * editor's quick-diff gutter markers. `getFileHunks` exposes those hunks (with the
 * removed/added lines) so the UI can peek a change; `revertHunk` undoes exactly one
 * of them while the rest of the file's edits stay put.
 *
 * Revert is a DETERMINISTIC splice of the file's own lines (replace the hunk's new
 * lines with its old lines at the hunk's coordinates), NOT `git apply -R`: a
 * zero-context hunk gives `git apply --unidiff-zero` no context to anchor on, so it
 * mis-positions a pure deletion by a line. The splice is anchored by git's exact
 * hunk header, so it's unambiguous.
 *
 * Security: hunk coordinates + content come entirely from `git diff` output
 * (trusted); the client only supplies the path (confined to the repo below), the
 * hunk index, and its `@@` header (validated to still match before anything is
 * written).
 */
import { readFile, writeFile } from 'node:fs/promises'
import { ApiError } from '@localixai/mini-app-sdk/backend'
import { confineToDir } from '../support/path-containment'
import type { RepoFileHunk } from '../contracts'
import type { GitRunner } from './cli'
import { readDiff } from './diff-read'
import { withHeadOrUnborn } from './head-or-unborn'

/** `@@ -oldStart[,oldCount] +newStart[,newCount] @@` — captures the four numbers. */
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

interface RawHunk {
  /** The verbatim `@@ … @@` header line. */
  header: string
  /** Body lines, each still carrying its `+`/`-`/`\` prefix (faithful for re-apply). */
  body: string[]
  newStart: number
  newCount: number
}

interface ParsedDiff {
  /** Everything before the first `@@` — the `diff --git`/`index`/`---`/`+++` header. */
  fileHeader: string
  hunks: RawHunk[]
}

/**
 * Split a single-file unified diff into its file header + hunks. Pure and
 * self-contained (no git, no fs) so the parse is unit-testable. Body lines keep
 * their prefix so a hunk can be re-serialized to a byte-identical patch.
 */
export function parseUnifiedHunks(diff: string): ParsedDiff {
  const headerLines: string[] = []
  const hunks: RawHunk[] = []
  let current: RawHunk | null = null
  let sawHunk = false
  for (const raw of diff.split('\n')) {
    const m = HUNK_RE.exec(raw)
    if (m) {
      sawHunk = true
      current = {
        header: raw,
        body: [],
        newStart: Number(m[3]),
        newCount: m[4] === undefined ? 1 : Number(m[4]),
      }
      hunks.push(current)
      continue
    }
    if (!sawHunk) {
      headerLines.push(raw)
      continue
    }
    // Inside a hunk body: keep +/-/\ lines (the "\ No newline at end of file"
    // marker matters for a faithful patch); the trailing '' from split ends it.
    if (current && (raw.startsWith('+') || raw.startsWith('-') || raw.startsWith('\\')))
      current.body.push(raw)
  }
  return { fileHeader: headerLines.join('\n'), hunks }
}

/** Map a raw hunk to the VCS-neutral, gutter-aligned shape the UI consumes. */
function toRepoHunk(h: RawHunk, index: number): RepoFileHunk {
  const oldLines: string[] = []
  const newLines: string[] = []
  for (const b of h.body) {
    if (b.startsWith('+')) newLines.push(b.slice(1))
    else if (b.startsWith('-')) oldLines.push(b.slice(1))
    // '\ No newline…' lines are structural, not content — skip for display.
  }
  // Modified-coordinate span, matching the quick-diff gutter's anchoring:
  // added/modified → the new-file line range; a pure deletion (newCount 0) →
  // the surviving line just above the removed block.
  const modifiedStart = h.newCount > 0 ? h.newStart : Math.max(h.newStart - 1, 1)
  const modifiedEnd = h.newCount > 0 ? h.newStart + h.newCount - 1 : modifiedStart
  return { index, header: h.header, modifiedStart, modifiedEnd, oldLines, newLines }
}

/**
 * A file's `-U0` hunks vs HEAD (vs the index on an unborn branch; HEAD is probed
 * only when the HEAD form failed). Binary → none. On an OVERFLOW the last hunk the
 * prefix holds may be missing body lines, and reverting it would splice a partial
 * old side into the file — so it is dropped; every earlier hunk ended before a
 * later header began and is complete.
 */
async function readHunks(run: GitRunner, path: string): Promise<RawHunk[]> {
  const read = await withHeadOrUnborn(
    run,
    (hasHead) =>
      readDiff(run, hasHead ? ['diff', '-U0', 'HEAD', '--', path] : ['diff', '-U0', '--', path]),
    (result) => result.failed,
  )
  if (!read.diff.trim() || read.binary) return []
  const { hunks } = parseUnifiedHunks(read.diff)
  return read.truncated ? hunks.slice(0, -1) : hunks
}

/**
 * All granular change hunks of a tracked file vs HEAD. Untracked/binary files
 * yield no hunks (a per-hunk revert doesn't apply — discard the whole file).
 */
export async function getFileHunks(run: GitRunner, path: string): Promise<RepoFileHunk[]> {
  return (await readHunks(run, path)).map(toRepoHunk)
}

/**
 * Split file content into lines, remembering whether it ended with a newline, so
 * a spliced round-trip preserves the file's trailing-newline state exactly.
 */
function splitLines(content: string): { lines: string[]; trailingNewline: boolean } {
  const trailingNewline = content.endsWith('\n')
  const body = trailingNewline ? content.slice(0, -1) : content
  return { lines: body.length === 0 ? [] : body.split('\n'), trailingNewline }
}

/**
 * Revert one hunk of a file back to its committed state. Re-derives the file's
 * `-U0` hunks, verifies the target index + header still match (else 409 — the file
 * moved on since the UI read it), then splices the hunk's old lines back in place
 * of its new lines and writes the file. Only that one change is undone; every other
 * edit in the file is left intact.
 */
export async function revertHunk(
  run: GitRunner,
  cwd: string,
  input: { path: string; index: number; header: string },
): Promise<void> {
  const { path, index, header } = input
  const hunk = (await readHunks(run, path))[index]
  if (!hunk || hunk.header !== header) {
    throw new ApiError(
      409,
      'hunk_stale',
      'This change no longer matches the file — refresh and try again.',
    )
  }

  // `cwd` is the repo top level (`repo-root.ts`), the base git's root-relative
  // paths resolve against; confined so a forged path cannot escape the repo.
  const abs = confineToDir(cwd, path)
  if (!abs) throw new ApiError(409, 'revert_failed', 'Could not revert this change.')

  const oldLines = hunk.body.flatMap((b) => (b.startsWith('-') ? [b.slice(1)] : []))
  const { lines, trailingNewline } = splitLines(await readFile(abs, 'utf8'))
  if (hunk.newCount > 0) {
    // Added/modified: replace the hunk's new lines with the old ones.
    lines.splice(hunk.newStart - 1, hunk.newCount, ...oldLines)
  } else {
    // Pure deletion: re-insert the removed lines after the surviving line
    // `newStart` (git's `+N,0` marks the deletion point as just after new line N).
    lines.splice(Math.min(hunk.newStart, lines.length), 0, ...oldLines)
  }
  await writeFile(abs, lines.join('\n') + (trailingNewline ? '\n' : ''), 'utf8')
}
