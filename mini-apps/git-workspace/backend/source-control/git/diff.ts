/**
 * Per-file unified diff for the git backend. The shape of the diff depends on
 * the file's state:
 *   - untracked → synthesized against an empty file (`diff --no-index`, which
 *     exits 1 by design, so its "failure" is ignored)
 *   - staged    → index vs HEAD (`diff --cached`)
 *   - otherwise → the full working change vs the last commit (`diff HEAD`),
 *     falling back to `diff` on an unborn branch (HEAD probed only on failure).
 *
 * `cwd` is the repo top level (`repo-root.ts`), so the root-relative status path
 * is a valid pathspec and a valid `--no-index` path alike.
 */
import type { FileDiff, FileDiffInput } from '../contracts'
import { relative } from 'node:path'
import { confineToDir } from '../support/path-containment'
import type { GitRunner } from './cli'
import { EMPTY_READ, readDiff, toFileDiff } from './diff-read'
import { withHeadOrUnborn } from './head-or-unborn'

export async function getFileDiff(
  run: GitRunner,
  cwd: string,
  input: FileDiffInput,
): Promise<FileDiff> {
  const { path, staged, untracked } = input

  if (untracked) {
    // `git diff --no-index` is a plain two-file comparator with NO repo
    // confinement (unlike `diff -- <path>`, which git restricts to the worktree),
    // so a client-supplied path like "/etc/passwd" or "../../secret" would be read
    // back verbatim as the "diff". Confine it to the repo root first; an escaping
    // path yields an empty diff rather than leaking an arbitrary file.
    const safe = confineToDir(cwd, path)
    if (!safe) return toFileDiff(path, EMPTY_READ)
    return toFileDiff(
      path,
      await readDiff(run, ['diff', '--no-index', '--', '/dev/null', relative(cwd, safe)]),
    )
  }
  if (staged) return toFileDiff(path, await readDiff(run, ['diff', '--cached', '--', path]))
  const read = await withHeadOrUnborn(
    run,
    (hasHead) => readDiff(run, hasHead ? ['diff', 'HEAD', '--', path] : ['diff', '--', path]),
    (result) => result.failed,
  )
  return toFileDiff(path, read)
}
