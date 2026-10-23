/**
 * Line-level (and hunk-level) staging for the git backend. Reads a
 * file's full-context diff, lets the caller select individual change lines, builds a
 * minimal patch of just those lines (pure `line-patch.ts`), and applies it with
 * `git apply`:
 *   - stageLines   → `git apply --cached`            (working→index for the selection)
 *   - unstageLines → `git apply --cached --reverse`  (index→HEAD for the selection)
 *   - discardLines → `git apply --reverse`           (worktree→index, DESTRUCTIVE)
 *
 * Every op derives its patch from git's OWN diff output, so line indices map to real
 * diff lines; a `diffId` fingerprint of the diff is verified before applying so a
 * file that moved on since the UI read it fails loudly (409) instead of corrupting.
 * A diff that outgrew the capture ceiling offers NO lines and refuses every op: a
 * patch built from a cut diff would stage against a hunk git never finished printing.
 *
 * `cwd` is the repo top level (the backend runs every op there — `repo-root.ts`), so
 * the `-- <path>` pathspec and the built patch's paths are both root-relative.
 */
import { createHash } from 'node:crypto'
import { ApiError } from '@localixai/mini-app-sdk/backend'
import type { FileDiffLines, LineStageMode } from '../contracts'
import { firstLine, runGitWithInput, type GitRunner } from './cli'
import { readDiff } from './diff-read'
import { buildLinePatch, parseFileDiff } from './line-patch'

/** Short stable fingerprint of a diff — the drift guard for a line selection. */
function fingerprint(diff: string): string {
  return createHash('sha1').update(diff).digest('hex').slice(0, 16)
}

/** The diff args for a mode: staged = index vs HEAD, unstaged = worktree vs index. */
function diffArgs(mode: LineStageMode, path: string): string[] {
  const base = mode === 'staged' ? ['diff', '--cached'] : ['diff']
  return [...base, '--', path]
}

/** A file's diff as indexed, selectable lines for a line-staging view. */
export async function getFileDiffLines(
  run: GitRunner,
  _cwd: string,
  input: { path: string; mode: LineStageMode },
): Promise<FileDiffLines> {
  const { diff, binary, truncated } = await readDiff(run, diffArgs(input.mode, input.path))
  const shape = { path: input.path, mode: input.mode }
  if (truncated) return { ...shape, diffId: '', lines: [], binary: false, truncated: true }
  if (!diff.trim()) return { ...shape, diffId: '', lines: [], binary: false }
  if (binary) return { ...shape, diffId: fingerprint(diff), lines: [], binary: true }
  return { ...shape, diffId: fingerprint(diff), lines: parseFileDiff(diff).lines, binary: false }
}

interface LineOpInput {
  path: string
  /** Raw-diff line indices to include (as returned in `FileDiffLines.lines[].index`). */
  lines: number[]
  /** Fingerprint of the diff the selection was made against — guards against drift. */
  diffId: string
}

/** Re-read the file's diff, verify it hasn't drifted, and build the selected-line patch. */
async function preparePatch(
  run: GitRunner,
  mode: LineStageMode,
  input: LineOpInput,
  reverse: boolean,
): Promise<string> {
  const { diff, binary, truncated } = await readDiff(run, diffArgs(mode, input.path))
  if (truncated) {
    throw new ApiError(
      409,
      'line_stage_too_large',
      'This diff is too large to stage by line — stage the whole file instead.',
    )
  }
  if (!diff.trim() || binary) {
    throw new ApiError(
      409,
      'line_stage_stale',
      'This change no longer exists — refresh and try again.',
    )
  }
  if (fingerprint(diff) !== input.diffId) {
    throw new ApiError(
      409,
      'line_stage_stale',
      'This file changed since you selected lines — refresh and try again.',
    )
  }
  const patch = buildLinePatch(diff, new Set(input.lines), { reverse })
  if (!patch) {
    throw new ApiError(400, 'line_stage_empty', 'No changed lines were selected.')
  }
  return patch
}

/** Apply a built patch at the repo root; a git-apply failure becomes a typed 409. */
async function applyPatch(
  root: string,
  args: string[],
  patch: string,
  errorCode: string,
  fallback: string,
): Promise<void> {
  const res = await runGitWithInput(root, ['apply', ...args], patch)
  if (!res.ok) throw new ApiError(409, errorCode, firstLine(res.stderr) || fallback)
}

/** Stage the selected lines: `git apply --cached` of a forward patch (worktree vs index). */
export async function stageLines(run: GitRunner, cwd: string, input: LineOpInput): Promise<void> {
  const patch = await preparePatch(run, 'unstaged', input, false)
  await applyPatch(
    cwd,
    ['--cached'],
    patch,
    'git_line_stage_failed',
    'Could not stage the selected lines.',
  )
}

/** Unstage the selected lines: reverse-apply a patch of the staged diff to the index. */
export async function unstageLines(run: GitRunner, cwd: string, input: LineOpInput): Promise<void> {
  const patch = await preparePatch(run, 'staged', input, true)
  await applyPatch(
    cwd,
    ['--cached', '--reverse'],
    patch,
    'git_line_unstage_failed',
    'Could not unstage the selected lines.',
  )
}

/** Discard the selected lines from the working tree (DESTRUCTIVE): reverse-apply to the worktree. */
export async function discardLines(run: GitRunner, cwd: string, input: LineOpInput): Promise<void> {
  const patch = await preparePatch(run, 'unstaged', input, true)
  await applyPatch(
    cwd,
    ['--reverse'],
    patch,
    'git_line_discard_failed',
    'Could not discard the selected lines.',
  )
}
