/**
 * Mutating git actions for the source-control backend: staging, discarding, and
 * committing. Each surfaces git's own message on failure (as a 409) so the UI
 * can show exactly why an operation was refused. `getCommitDiff` is read-only —
 * it gathers the text a commit message is generated from.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ApiError } from '@localixai/mini-app-sdk/backend'
import { firstLine, type GitRunner } from './cli'
import { getWorkingDiff } from './working-diff'
import { captureRepresentativeTrackedDiff } from './diff-capture'
import { hasHead, withHeadOrUnborn } from './head-or-unborn'

/**
 * Append gitignore patterns to the repo's `.gitignore` (creating it if absent).
 * Patterns already present verbatim (same trimmed line) are skipped so repeated
 * "Add to .gitignore" clicks stay idempotent. The file is always left ending in a
 * newline. `cwd` is the repo root, so the patterns are anchored relative to it.
 */
export async function addToGitignore(cwd: string, patterns: string[]): Promise<void> {
  const wanted = patterns.map((p) => p.trim()).filter(Boolean)
  if (wanted.length === 0) return
  const file = join(cwd, '.gitignore')
  let existing = ''
  try {
    existing = await readFile(file, 'utf8')
  } catch {
    existing = ''
  }
  const present = new Set(existing.split('\n').map((l) => l.trim()))
  const additions = wanted.filter((p) => !present.has(p))
  if (additions.length === 0) return
  const prefix = existing.length === 0 || existing.endsWith('\n') ? existing : `${existing}\n`
  try {
    await writeFile(file, `${prefix}${additions.join('\n')}\n`, 'utf8')
  } catch (err) {
    throw new ApiError(
      409,
      'git_gitignore_failed',
      err instanceof Error ? err.message : 'Could not update .gitignore.',
    )
  }
}

/** Stage paths (files or directories): `git add -- <paths>`. */
export async function stage(run: GitRunner, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const res = await run(['add', '--', ...paths])
  if (!res.ok)
    throw new ApiError(409, 'git_stage_failed', firstLine(res.stderr) || 'Could not stage changes.')
}

/** Unstage paths: `git reset -q -- <paths>` (index back to HEAD, working tree untouched). */
export async function unstage(run: GitRunner, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const res = await run(['reset', '-q', '--', ...paths])
  if (!res.ok)
    throw new ApiError(
      409,
      'git_unstage_failed',
      firstLine(res.stderr) || 'Could not unstage changes.',
    )
}

/**
 * Discard working-tree changes only. Restore tracked paths from the index,
 * preserving staged content, including on an unborn branch. Delete untracked
 * paths. Enumerate tracked paths first so mixed tracked/untracked requests do
 * not make restore reject the entire request.
 *
 * Every command failure throws so the per-repo mutation queue can retry a
 * transient index lock; no failed restore or clean is reported as success.
 */
export async function discard(run: GitRunner, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const listed = await run(['ls-files', '-z', '--', ...paths])
  if (!listed.ok) {
    throw new ApiError(
      409,
      'git_discard_failed',
      firstLine(listed.stderr) || 'Could not list tracked files.',
    )
  }
  const trackedPaths = [...new Set(listed.stdout.split('\0').filter(Boolean))]
  const tracked =
    trackedPaths.length > 0
      ? await run(['restore', '--worktree', '--', ...trackedPaths])
      : { ok: true, stderr: '' }
  if (!tracked.ok) {
    throw new ApiError(
      409,
      'git_discard_failed',
      firstLine(tracked.stderr) || 'Could not discard changes.',
    )
  }
  // Remove untracked files/dirs within the paths.
  const untracked = await run(['clean', '-fdq', '--', ...paths])
  if (!untracked.ok) {
    throw new ApiError(
      409,
      'git_discard_failed',
      firstLine(untracked.stderr) || 'Could not remove untracked files.',
    )
  }
}

/**
 * Discard EVERYTHING in the working tree — the "nuke" escape hatch. `git reset
 * --hard HEAD` throws away all tracked staged+unstaged changes; when
 * `removeUntracked` is set, `git clean -fd` also deletes untracked files/dirs.
 * We use `-fd` (NOT `-fdx`) on purpose so ignored build/dependency dirs
 * (`node_modules`, `dist`, …) survive — nuking source changes shouldn't force a
 * multi-minute reinstall. On an unborn branch (no HEAD) the index is reset
 * instead of `reset --hard`. Destructive and irreversible; the UI always gates
 * this behind a confirm.
 */
export async function nukeWorkingTree(
  run: GitRunner,
  opts: { removeUntracked: boolean },
): Promise<void> {
  const res = await withHeadOrUnborn(
    run,
    (withHead) => (withHead ? run(['reset', '--hard', 'HEAD']) : run(['reset', '-q'])),
    (result) => !result.ok,
  )
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_nuke_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Could not discard working-tree changes.',
    )
  }
  if (opts.removeUntracked) {
    const clean = await run(['clean', '-fd'])
    if (!clean.ok) {
      throw new ApiError(
        409,
        'git_nuke_failed',
        firstLine(clean.stderr) || firstLine(clean.stdout) || 'Could not remove untracked files.',
      )
    }
  }
}

/** Trailer added to every commit so authorship credits the assistant. */
const COAUTHOR_TRAILER = 'Co-Authored-By: Localix <noreply@localix.ai>'

/** Append the Co-Authored-By trailer (its own paragraph) unless it's already present. */
export function withCoAuthor(message: string): string {
  return message.includes(COAUTHOR_TRAILER)
    ? message
    : `${message.trimEnd()}\n\n${COAUTHOR_TRAILER}`
}

/** Commit the staged changes: `git commit -m <message>` (+ Co-Authored-By trailer). */
export async function commit(run: GitRunner, message: string): Promise<void> {
  const res = await run(['commit', '-m', withCoAuthor(message)])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_commit_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Commit failed.',
    )
  }
}

/**
 * Rewrite the last commit — `git commit --amend -m <message>` — folding the
 * currently-staged changes into it (or, with nothing staged, just replacing the
 * message). Refuses on an unborn branch (no HEAD to amend). Like a normal commit,
 * amend rewrites HEAD's sha; the notes-rewrite config (set before writing a note)
 * carries the localix provenance note across, and the service overwrites it with
 * fresh metadata afterwards. NOTE: this rewrites published history if the commit
 * was already pushed — the UI only exposes it for local work.
 */
export async function amend(run: GitRunner, message: string): Promise<void> {
  // Probed FIRST on purpose, unlike the reads: a rare, user-initiated rewrite is worth
  // one spawn to guarantee no commit (and no hook) is ever attempted without a HEAD.
  if (!(await hasHead(run))) {
    throw new ApiError(
      409,
      'git_amend_failed',
      'Nothing to amend — this branch has no commits yet.',
    )
  }
  const res = await run(['commit', '--amend', '-m', withCoAuthor(message)])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_amend_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Amend failed.',
    )
  }
}

/**
 * The change set a commit message should summarize: the staged diff when
 * anything is staged, otherwise the full working change vs HEAD (or the index on
 * an unborn branch). Returns complete diff evidence for ordinary patches and a
 * bounded, breadth-preserving sample for very large ones, plus a compact `--stat`
 * summary (per-file ± counts for tracked paths). The server pairs it with the
 * complete status inventory, which also covers untracked files when the index is
 * empty.
 */
export async function getCommitDiff(
  run: GitRunner,
  cwd: string,
): Promise<{ diff: string; stat: string; staged: boolean }> {
  // The model-facing renderer retains at most 12 KB. Bound acquisition much
  // earlier than the shared 8 MB Git ceiling so a giant patch remains cheap:
  // the status inventory and stat stay complete while captured diff evidence is
  // explicitly representative. Untracked files run separately, hence the much
  // tighter per-file ceiling.
  const trackedCaptureBytes = 2_000_000
  const statCaptureBytes = 512_000
  const perFileCaptureBytes = 96_000
  const representativeTrackedFiles = 24
  // Both answers are needed before either branch below; neither depends on the other.
  const [stagedNames, headExists] = await Promise.all([
    run(['diff', '--cached', '--name-only']),
    hasHead(run),
  ])
  if (stagedNames.stdout.trim().length > 0) {
    const base = ['diff', '--cached']
    const [captured, stat] = await Promise.all([
      run(base, undefined, undefined, trackedCaptureBytes),
      run([...base, '--stat'], undefined, undefined, statCaptureBytes),
    ])
    let diff = captured.stdout
    if (!captured.ok && /^diff --git /m.test(diff)) {
      const numstat = await run([...base, '--numstat', '-z'])
      const representative = await captureRepresentativeTrackedDiff(run, base, numstat.stdout, {
        maxFiles: representativeTrackedFiles,
        maxBufferBytes: perFileCaptureBytes,
      })
      if (representative) diff = representative
    }
    return { diff, stat: stat.stdout, staged: true }
  }

  // The Commit button stages everything when the index is empty, including
  // untracked files. `git diff HEAD` omits those files, while getWorkingDiff
  // synthesizes a confined `--no-index` patch for each one. Use that exact
  // future commit set so the model never names a commit from tracked changes
  // while silently missing a newly-created file.
  const [working, stat] = await Promise.all([
    // Commit completion needs representative evidence, not an unbounded in-memory
    // concatenation of every huge new file. The complete status inventory remains
    // authoritative; sampling is spread across the untracked path list.
    getWorkingDiff(run, cwd, headExists, {
      maxUntrackedFiles: 48,
      maxUntrackedPatchChars: 64_000,
      maxTrackedCaptureBytes: trackedCaptureBytes,
      maxUntrackedCaptureBytes: perFileCaptureBytes,
      maxTrackedFiles: representativeTrackedFiles,
      maxTrackedFileCaptureBytes: perFileCaptureBytes,
    }),
    run(
      [...(headExists ? ['diff', 'HEAD'] : ['diff']), '--stat'],
      undefined,
      undefined,
      statCaptureBytes,
    ),
  ])
  return { diff: working.diff, stat: stat.stdout, staged: false }
}
