/**
 * The one reader every diff route goes through.
 *
 * Two defects made it necessary. First, a diff larger than the capture ceiling came back from
 * the runner as `ok:false` with a PREFIX of the patch, and each route guessed what that meant:
 * a commit showed "This commit has no changes", a compare threw a 409 whose message was the
 * first diff line, a stash retried and came back empty, and a file diff handed the UI a patch
 * cut mid-hunk. Second, `binary` was a regex copied into seven modules that marked a whole
 * multi-file diff binary when ANY one file was, so a commit touching one image and ten source
 * files refused to open as "only binary files".
 *
 * So a read takes the overflow from the runner's own `truncated` flag, cuts the prefix back to
 * the last COMPLETE file so no consumer parses half a hunk, and `binary` means "the diff carries
 * no textual hunk at all" — true for a binary single file, and for a multi-file diff only when
 * every file in it is binary.
 */
import type { FileDiff } from '../contracts'
import type { GitRunner } from './cli'

export interface DiffRead {
  /** The patch; on truncation, cut back to its last complete file (or complete line). */
  diff: string
  binary: boolean
  truncated: boolean
  /** git refused the read (bad ref, not a repo). An overflow is NOT a failure: its prefix is usable. */
  failed: boolean
  stderr: string
}

/** A binary change's marker line: plain `diff` or `diff --binary` output. */
const BINARY_MARKER = /^(?:Binary files |GIT binary patch$)/m
/** A textual hunk header — `@@` for a normal diff, `@@@` for a combined one. */
const TEXT_HUNK = /^@@/m

/** True when the diff changes binary content and carries no textual hunk at all. */
export function isBinaryDiff(diff: string): boolean {
  return BINARY_MARKER.test(diff) && !TEXT_HUNK.test(diff)
}

/**
 * Cut an overflowed prefix back to what can be rendered faithfully: everything before the last
 * `diff --git` header that began inside the prefix (so the file the ceiling cut through is
 * dropped whole). A single-file prefix has no earlier boundary; it keeps its complete lines.
 */
export function cutToCompleteFile(prefix: string): string {
  const lastFile = prefix.lastIndexOf('\ndiff --git ')
  if (lastFile >= 0) return prefix.slice(0, lastFile + 1)
  const lastLine = prefix.lastIndexOf('\n')
  return lastLine >= 0 ? prefix.slice(0, lastLine + 1) : ''
}

/** Run one diff-producing git command and classify its output. Never throws. */
export async function readDiff(
  run: GitRunner,
  args: string[],
  maxBufferBytes?: number,
): Promise<DiffRead> {
  const res = await run(args, undefined, undefined, maxBufferBytes)
  // A read killed on its deadline also hands back a prefix of a real patch; it is
  // truncated in the same sense and keeps its complete files.
  const truncated = res.truncated === true || (res.timedOut === true && res.stdout !== '')
  const diff = truncated ? cutToCompleteFile(res.stdout) : res.stdout
  return {
    diff,
    binary: isBinaryDiff(diff),
    truncated,
    failed: !res.ok && !truncated,
    stderr: res.stderr,
  }
}

/** The wire shape of a read: `truncated` appears only when something was omitted. */
export function toFileDiff(
  path: string,
  read: Pick<DiffRead, 'diff' | 'binary' | 'truncated'>,
): FileDiff {
  return {
    path,
    diff: read.diff,
    binary: read.binary,
    ...(read.truncated ? { truncated: true } : {}),
  }
}

/** A read that produced nothing — the tolerant shape for a refused or empty read. */
export const EMPTY_READ: Pick<DiffRead, 'diff' | 'binary' | 'truncated'> = {
  diff: '',
  binary: false,
  truncated: false,
}
