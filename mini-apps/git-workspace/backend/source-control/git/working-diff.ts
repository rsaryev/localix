/**
 * The FULL working-tree diff for the git backend, as one pure multi-file unified
 * diff string — everything the Changes tree shows in a single "open all" surface.
 * Combines the tracked change (`git diff HEAD`, or `git diff` on an unborn branch)
 * with a synthesized patch for each untracked file (`diff --no-index /dev/null`,
 * confined to the repo like `getFileDiff`), so an all-untracked repo still yields
 * a complete diff. `runGit` never throws; a failed read contributes nothing.
 *
 * The tracked read and the untracked listing are independent, so they spawn at
 * once. Every read is BOUNDED — the UI route used to pass no limits at all, so a
 * tree with thousands of new files fanned out one `--no-index` process per file and
 * buffered every one — and anything a bound leaves out sets `truncated` on the
 * result instead of vanishing silently.
 */
import type { FileDiff } from '../contracts'
import { confineToDir } from '../support/path-containment'
import { mapLimit } from '../support/map-limit'
import { spreadSample } from '../support/spread-sample'
import type { GitRunner } from './cli'
import { captureRepresentativeTrackedDiff } from './diff-capture'
import { isBinaryDiff, readDiff, type DiffRead } from './diff-read'
import { withHeadOrUnborn } from './head-or-unborn'

/** Untracked patches are `--no-index` reads — they never open the repo index, so a
 *  few can run at once. Capped so a repo full of new files can't fan out unbounded. */
const UNTRACKED_DIFF_CONCURRENCY = 8

export interface WorkingDiffLimits {
  /** Evenly sample at most this many untracked paths; tracked diff is unaffected. */
  maxUntrackedFiles?: number
  /** Bound each captured untracked patch while preserving both its head and tail. */
  maxUntrackedPatchChars?: number
  /** Stop the tracked git process after this many captured bytes. */
  maxTrackedCaptureBytes?: number
  /** Stop each untracked git process after this many captured bytes. */
  maxUntrackedCaptureBytes?: number
  /** On tracked overflow, sample at most this many paths from the full numstat. */
  maxTrackedFiles?: number
  /** Per-path ceiling used only by the tracked overflow fallback. */
  maxTrackedFileCaptureBytes?: number
}

/**
 * The bounds of the UI's "open all changes" read. Enough for any tree a person reviews
 * in one surface; past them the result says `truncated` and the Changes tree (which
 * reads status, not this diff) still lists every file.
 */
export const UI_WORKING_DIFF_LIMITS: WorkingDiffLimits = {
  maxUntrackedFiles: 200,
  maxUntrackedCaptureBytes: 1_000_000,
}

function boundPatch(patch: string, maxChars: number | undefined): string {
  if (maxChars === undefined || patch.length <= maxChars) return patch
  const marker = '\n… untracked patch capture omitted …\n'
  const available = Math.max(0, maxChars - marker.length)
  const headTarget = Math.ceil(available * 0.7)
  const tailTarget = Math.max(0, available - headTarget)
  // Prefer complete lines at both cut points. Besides being easier for the model
  // to read, this avoids inventing a malformed +/- line where a raw character
  // slice happened to split a long source line.
  const priorNewline = patch.lastIndexOf('\n', headTarget)
  const nextNewline = patch.indexOf('\n', Math.max(0, patch.length - tailTarget))
  const headEnd = priorNewline > 0 ? priorNewline : headTarget
  const tailStart = nextNewline >= 0 ? nextNewline + 1 : patch.length - tailTarget
  return `${patch.slice(0, headEnd).trimEnd()}${marker}${patch.slice(tailStart).trimStart()}`
}

interface TrackedRead {
  base: string[]
  read: DiffRead
}

/** `git diff HEAD`, or `git diff` on an unborn branch — probing HEAD only if it failed. */
function readTracked(
  run: GitRunner,
  knownHasHead: boolean | undefined,
  captureBytes: number | undefined,
): Promise<TrackedRead> {
  const at = async (hasHead: boolean): Promise<TrackedRead> => {
    const base = hasHead ? ['diff', 'HEAD'] : ['diff']
    return { base, read: await readDiff(run, base, captureBytes) }
  }
  if (knownHasHead !== undefined) return at(knownHasHead)
  return withHeadOrUnborn(run, at, (result) => result.read.failed)
}

export async function getWorkingDiff(
  run: GitRunner,
  cwd: string,
  knownHasHead?: boolean,
  limits: WorkingDiffLimits = {},
): Promise<FileDiff> {
  const [tracked, others] = await Promise.all([
    readTracked(run, knownHasHead, limits.maxTrackedCaptureBytes),
    run(['ls-files', '--others', '--exclude-standard', '-z']),
  ])
  const parts: string[] = []
  let truncated = tracked.read.truncated
  // An overflowing tracked read keeps its complete leading files (diff-read.ts);
  // dropping that prefix made a very large tracked change look like an
  // all-untracked or empty change set.
  if (tracked.read.diff && !tracked.read.failed) {
    let trackedText = tracked.read.diff
    if (
      tracked.read.truncated &&
      limits.maxTrackedFiles !== undefined &&
      limits.maxTrackedFileCaptureBytes !== undefined
    ) {
      const numstat = await run([...tracked.base, '--numstat', '-z'])
      const representative = await captureRepresentativeTrackedDiff(
        run,
        tracked.base,
        numstat.stdout,
        {
          maxFiles: limits.maxTrackedFiles,
          maxBufferBytes: limits.maxTrackedFileCaptureBytes,
        },
      )
      if (representative) trackedText = representative
    }
    parts.push(trackedText)
  }

  // Untracked files aren't part of `git diff` — synthesize each against an empty
  // file so the "full diff" shows new files too (mirrors getFileDiff's untracked path).
  if (others.ok && others.stdout) {
    // `ls-files` returns repo-relative paths (cwd is the repo root). Keep the
    // absolute containment check, but hand git the relative form so its patch
    // headers do not expose the user's local workspace path to model context.
    const safeRelativePaths = others.stdout
      .split('\0')
      .filter((rel) => rel && confineToDir(cwd, rel))
    const selectedPaths = spreadSample(safeRelativePaths, limits.maxUntrackedFiles)
    if (selectedPaths.length < safeRelativePaths.length) truncated = true
    const untracked = await mapLimit(selectedPaths, UNTRACKED_DIFF_CONCURRENCY, async (rel) => {
      // --no-index exits 1 when the files differ, so `failed` is expected here.
      const read = await readDiff(
        run,
        ['diff', '--no-index', '--', '/dev/null', rel],
        limits.maxUntrackedCaptureBytes,
      )
      const bounded = boundPatch(read.diff, limits.maxUntrackedPatchChars)
      return { patch: bounded, cut: read.truncated || bounded !== read.diff }
    })
    for (const { patch, cut } of untracked) {
      if (patch) parts.push(patch)
      if (cut) truncated = true
    }
  }

  const diff = parts.join('\n')
  return {
    path: 'working-tree',
    diff,
    binary: isBinaryDiff(diff),
    ...(truncated ? { truncated: true } : {}),
  }
}
