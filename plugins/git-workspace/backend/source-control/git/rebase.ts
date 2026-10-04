/**
 * Interactive-rebase family for the git backend — history rewrites
 * driven ENTIRELY non-interactively. The user composes a todo (pick / reword /
 * squash / fixup / drop, reordered) in the UI; we hand git a computed todo file
 * through a scripted `GIT_SEQUENCE_EDITOR` so `git rebase -i` never opens a real
 * editor or blocks on a tty.
 *
 * The mechanism (see `runSequencedRebase`):
 *  - We write OUR todo text to a temp file and point `GIT_SEQUENCE_EDITOR` at a
 *    tiny shell script that `cat`s it over git's todo file (`$1`). The todo path
 *    is passed via the `LOCALIX_REBASE_TODO` env var, never interpolated into a
 *    command string — so a path (or todo body) can't be read as a shell token.
 *  - `GIT_EDITOR=true` makes any message editor a no-op: `squash` keeps git's
 *    default combined message; a plain rebase never prompts.
 *  - A `reword` never uses the editor. We emit `pick <sha>` followed by
 *    `exec git commit --amend -F <msgfile>`, so the exact new message is applied
 *    deterministically to that specific commit right after it is replayed.
 *
 * SAFETY: every op refuses on a dirty working tree (typed `git_rebase_dirty`) —
 * a rebase would otherwise fail or clobber uncommitted work. On a conflict git
 * stops mid-rebase; we surface `git_rebase_conflict` with git's own stderr and
 * leave the rebase in progress so the header banner + Changes tree can drive
 * continue/abort/skip. Any other failure is `git_rebase_failed`.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// A reword's `exec` todo line runs in `sh`, so its message-file path is POSIX-quoted.
import { ApiError, shellQuote } from '@localixai/plugin-sdk/backend'
import type { RebaseAction, RebaseState, RebaseTodoEntry } from '../contracts'
import { firstLine, type GitRunner } from './cli'
import { gitPathResolver } from './git-paths'
import { withCoAuthor } from './actions'

/** Env that neutralizes every interactive editor git might reach for. */
function noEditorEnv(): NodeJS.ProcessEnv {
  return { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' }
}

// --- Pure todo builder --------------------------------------------------------

/** One resolved todo row — a reword carries the path of its message file. */
export interface TodoLine {
  hash: string
  action: RebaseAction
  /** Message file for a `reword` (already written to disk); ignored otherwise. */
  msgFile?: string
}

/**
 * Render a git-rebase-todo from resolved rows (PURE — the unit-tested core).
 * `reword` becomes `pick` + an `exec git commit --amend -F <msgfile>` so the new
 * message is applied without any editor. `drop` is emitted explicitly (clearer
 * than omission and equally valid). Rows are in git's todo order: top = applied
 * first = oldest.
 */
export function buildRebaseTodo(lines: TodoLine[]): string {
  const out: string[] = []
  for (const l of lines) {
    switch (l.action) {
      case 'reword':
        out.push(`pick ${l.hash}`)
        if (l.msgFile) out.push(`exec git commit --amend -F ${shellQuote(l.msgFile)}`)
        break
      case 'pick':
      case 'squash':
      case 'fixup':
      case 'drop':
        out.push(`${l.action} ${l.hash}`)
        break
    }
  }
  return out.join('\n') + '\n'
}

// --- Rebase in-progress state -------------------------------------------------

async function readIntFile(path: string): Promise<number | undefined> {
  try {
    const n = Number.parseInt((await readFile(path, 'utf8')).trim(), 10)
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

/**
 * Read the in-progress rebase state, or `undefined` when none is underway.
 * Detected by the presence of git's `rebase-merge`/`rebase-apply` dir; step
 * counts (`msgnum`/`end`) and `onto` are best-effort reads.
 *
 * Pass `gitDir` (the absolute per-worktree `.git` dir) when the caller already
 * has it — the whole check then costs two `existsSync` calls and no git spawn,
 * which is what makes an idle status poll cheap.
 */
export async function readRebaseState(
  run: GitRunner,
  cwd: string,
  gitDir?: string,
): Promise<RebaseState | undefined> {
  // `gitDir` (already known by the status read) turns both lookups into joins.
  const gitPath = gitPathResolver(run, cwd, gitDir)
  const [mergeDir, applyDir] = await Promise.all([gitPath('rebase-merge'), gitPath('rebase-apply')])
  const dir =
    mergeDir && existsSync(mergeDir) ? mergeDir : applyDir && existsSync(applyDir) ? applyDir : null
  if (!dir) return undefined
  const [step, total] = await Promise.all([
    readIntFile(join(dir, 'msgnum')),
    readIntFile(join(dir, 'end')),
  ])
  let onto: string | undefined
  try {
    onto = (await readFile(join(dir, 'onto'), 'utf8')).trim().slice(0, 12) || undefined
  } catch {
    /* best-effort */
  }
  return {
    rebasing: true,
    ...(step !== undefined ? { step } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(onto ? { onto } : {}),
  }
}

// --- Guards + range resolution ------------------------------------------------

/** True when the working tree has ANY tracked change (staged or unstaged). Untracked files are ignored — a rebase tolerates them. */
async function hasTrackedChanges(run: GitRunner): Promise<boolean> {
  const res = await run(['status', '--porcelain', '--untracked-files=no'])
  return res.ok && res.stdout.trim().length > 0
}

/** Refuse a rebase while tracked changes could be lost or would block git. */
async function requireCleanTree(run: GitRunner): Promise<void> {
  if (await hasTrackedChanges(run)) {
    throw new ApiError(
      409,
      'git_rebase_dirty',
      'The working tree has uncommitted changes. Commit or stash them before rewriting history.',
    )
  }
}

/** Full shas in `<base>..HEAD` (or all of HEAD when base is null), newest first. */
async function rangeHashes(run: GitRunner, base: string | null): Promise<string[]> {
  const res = await run(['rev-list', base ? `${base}..HEAD` : 'HEAD'])
  if (!res.ok) return []
  return res.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

/** Resolve the parent of `fromHash` as the rebase base, or null when it's the root commit (→ `--root`). */
async function resolveBase(run: GitRunner, fromHash: string): Promise<string | null> {
  const parent = await run(['rev-parse', '--verify', `${fromHash}^`])
  return parent.ok ? parent.stdout.trim() : null
}

/** Map a possibly-abbreviated ref to a full sha; throws `git_bad_ref` when unknown. */
async function fullSha(run: GitRunner, ref: string): Promise<string> {
  const res = await run(['rev-parse', '--verify', `${ref}^{commit}`])
  if (!res.ok)
    throw new ApiError(400, 'git_bad_ref', firstLine(res.stderr) || `Unknown commit: ${ref}`)
  return res.stdout.trim()
}

// --- Sequenced-rebase runner --------------------------------------------------

/**
 * Run `git rebase -i <base>` (or `--root`) with a pre-composed todo. Writes the
 * todo + any reword message files + the sequence-editor script to a private temp
 * dir, then invokes git with the scripted editors. On a clean finish the temp dir
 * is removed; on a conflict (rebase left in progress) it is LEFT in place so a
 * later `--continue` can still read a reword's message file.
 */
async function runSequencedRebase(
  run: GitRunner,
  cwd: string,
  baseArg: string,
  lines: Omit<TodoLine, 'msgFile'>[],
  rewordMessages: Map<string, string>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'localix-rebase-'))
  let leaveTempDir = false
  try {
    // Materialize reword message files, then the todo referencing them.
    const resolved: TodoLine[] = []
    let i = 0
    for (const l of lines) {
      if (l.action === 'reword') {
        const msg = rewordMessages.get(l.hash)
        if (msg === undefined)
          throw new ApiError(400, 'git_rebase_failed', `Missing reword message for ${l.hash}.`)
        const msgFile = join(dir, `msg-${i++}`)
        await writeFile(msgFile, withCoAuthor(msg), 'utf8')
        resolved.push({ ...l, msgFile })
      } else {
        resolved.push(l)
      }
    }

    const todoPath = join(dir, 'todo')
    await writeFile(todoPath, buildRebaseTodo(resolved), 'utf8')

    // Sequence editor: overwrite git's todo file ($1) with ours. The todo path
    // arrives via env (never the command string) so nothing is shell-interpolated.
    const seqEditor = join(dir, 'seq-editor.sh')
    await writeFile(seqEditor, '#!/bin/sh\ncat "$LOCALIX_REBASE_TODO" > "$1"\n', 'utf8')
    await chmod(seqEditor, 0o755)

    const env: NodeJS.ProcessEnv = {
      ...noEditorEnv(),
      GIT_SEQUENCE_EDITOR: seqEditor,
      LOCALIX_REBASE_TODO: todoPath,
    }
    const res = await run(['rebase', '-i', baseArg], env)
    if (!res.ok) {
      const state = await readRebaseState(run, cwd)
      const message = firstLine(res.stderr) || firstLine(res.stdout) || 'Rebase failed.'
      if (state?.rebasing) {
        leaveTempDir = true // a pending reword exec may still need its message file
        throw new ApiError(409, 'git_rebase_conflict', message)
      }
      throw new ApiError(409, 'git_rebase_failed', message)
    }
  } finally {
    if (!leaveTempDir) await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

// --- Public operations --------------------------------------------------------

/**
 * Apply a composed interactive rebase over `fromHash..HEAD`. Validates that the
 * entries are EXACTLY the commits in range (any order), that at least one is not
 * dropped, and that the first kept row isn't a squash/fixup (nothing precedes it
 * to fold into). Refuses on a dirty tree.
 */
export async function interactiveRebase(
  run: GitRunner,
  cwd: string,
  fromHash: string,
  entries: RebaseTodoEntry[],
): Promise<void> {
  await requireCleanTree(run)
  const base = await resolveBase(run, fromHash)
  const [rangeShas, shas] = await Promise.all([
    rangeHashes(run, base),
    Promise.all(entries.map((e) => fullSha(run, e.hash))),
  ])
  const expected = new Set(rangeShas)
  const seen = new Set<string>()
  for (const [i, e] of entries.entries()) {
    const sha = shas[i]!
    if (!expected.has(sha))
      throw new ApiError(400, 'git_rebase_range', `Commit ${e.hash} is not in the selected range.`)
    if (seen.has(sha))
      throw new ApiError(400, 'git_rebase_range', `Commit ${e.hash} appears more than once.`)
    seen.add(sha)
  }
  if (seen.size !== expected.size) {
    throw new ApiError(
      400,
      'git_rebase_range',
      'The todo must cover exactly the commits in the selected range.',
    )
  }
  const kept = entries.filter((e) => e.action !== 'drop')
  if (kept.length === 0)
    throw new ApiError(400, 'git_rebase_range', 'A rebase must keep at least one commit.')
  if (kept[0]!.action === 'squash' || kept[0]!.action === 'fixup') {
    throw new ApiError(
      400,
      'git_rebase_range',
      'The first kept commit cannot be a squash/fixup — there is nothing before it to fold into.',
    )
  }

  const rewordMessages = new Map<string, string>()
  for (const [i, e] of entries.entries()) {
    if (e.action === 'reword') {
      if (!e.message?.trim())
        throw new ApiError(
          400,
          'git_rebase_range',
          `A reworded commit (${e.hash}) needs a message.`,
        )
      rewordMessages.set(shas[i]!, e.message)
    }
  }
  const lines = entries.map((e, i) => ({ hash: shas[i]!, action: e.action }))
  await runSequencedRebase(run, cwd, base ? base : '--root', lines, rewordMessages)
}

/**
 * Change an existing commit's message. When it's HEAD this is a plain
 * `commit --amend`; otherwise a one-commit reword rebase (pick everything from
 * `hash` to HEAD, reword `hash`). Refuses on a dirty tree for the rebase path.
 */
export async function rewordCommit(
  run: GitRunner,
  cwd: string,
  hash: string,
  message: string,
): Promise<void> {
  const sha = await fullSha(run, hash)
  const head = (await run(['rev-parse', '--verify', 'HEAD'])).stdout.trim()
  if (sha === head) {
    const res = await run(['commit', '--amend', '-m', withCoAuthor(message)])
    if (!res.ok)
      throw new ApiError(
        409,
        'git_rebase_failed',
        firstLine(res.stderr) || firstLine(res.stdout) || 'Could not reword the commit.',
      )
    return
  }
  await requireCleanTree(run)
  const base = await resolveBase(run, sha)
  const inRange = (await rangeHashes(run, base)).reverse() // oldest first for the todo
  const lines = inRange.map((h) => ({
    hash: h,
    action: (h === sha ? 'reword' : 'pick') as RebaseAction,
  }))
  await runSequencedRebase(run, cwd, base ? base : '--root', lines, new Map([[sha, message]]))
}

/**
 * Fold the currently-staged changes into an older commit: `git commit --fixup`
 * then a non-interactive `rebase -i --autosquash`. Requires something staged and
 * no unstaged tracked changes (which would block the rebase).
 */
export async function fixupInto(run: GitRunner, cwd: string, hash: string): Promise<void> {
  const sha = await fullSha(run, hash)
  const stagedEmpty = (await run(['diff', '--cached', '--quiet'])).ok
  if (stagedEmpty)
    throw new ApiError(
      400,
      'git_rebase_nothing_staged',
      'Nothing is staged to fold in. Stage the changes you want to squash into the commit first.',
    )
  const unstaged = await run(['diff', '--quiet']) // exit 1 (ok:false) when there ARE unstaged changes
  if (!unstaged.ok) {
    throw new ApiError(
      409,
      'git_rebase_dirty',
      'You have unstaged changes to tracked files. Stage or stash them before fixing up into an older commit.',
    )
  }
  const fixup = await run(['commit', `--fixup=${sha}`])
  if (!fixup.ok)
    throw new ApiError(
      409,
      'git_rebase_failed',
      firstLine(fixup.stderr) || 'Could not create the fixup commit.',
    )

  const base = await resolveBase(run, sha)
  // Autosquash arranges the fixup! commit under its target; the scripted editor
  // just accepts git's todo (GIT_SEQUENCE_EDITOR=true), no editor prompts.
  const res = await run(['rebase', '-i', '--autosquash', base ? base : '--root'], noEditorEnv())
  if (!res.ok) {
    const state = await readRebaseState(run, cwd)
    const message = firstLine(res.stderr) || firstLine(res.stdout) || 'Fixup rebase failed.'
    throw new ApiError(409, state?.rebasing ? 'git_rebase_conflict' : 'git_rebase_failed', message)
  }
}

/** Rebase the current branch onto `base` (a commit or branch). Refuses on a dirty tree. */
export async function rebaseOnto(run: GitRunner, cwd: string, base: string): Promise<void> {
  await requireCleanTree(run)
  const target = await fullSha(run, base)
  const res = await run(['rebase', target], noEditorEnv())
  if (!res.ok) {
    const state = await readRebaseState(run, cwd)
    const message = firstLine(res.stderr) || firstLine(res.stdout) || 'Rebase failed.'
    throw new ApiError(409, state?.rebasing ? 'git_rebase_conflict' : 'git_rebase_failed', message)
  }
}

/** Continue an in-progress rebase after conflicts were resolved (+ staged). */
export async function rebaseContinue(run: GitRunner, cwd: string): Promise<void> {
  const res = await run(['rebase', '--continue'], noEditorEnv())
  if (!res.ok) {
    const state = await readRebaseState(run, cwd)
    const message =
      firstLine(res.stderr) || firstLine(res.stdout) || 'Could not continue the rebase.'
    throw new ApiError(409, state?.rebasing ? 'git_rebase_conflict' : 'git_rebase_failed', message)
  }
}

/** Abort an in-progress rebase, restoring the pre-rebase state. */
export async function rebaseAbort(run: GitRunner): Promise<void> {
  const res = await run(['rebase', '--abort'])
  if (!res.ok)
    throw new ApiError(
      409,
      'git_rebase_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Could not abort the rebase.',
    )
}

/** Skip the current patch of an in-progress rebase. */
export async function rebaseSkip(run: GitRunner, cwd: string): Promise<void> {
  const res = await run(['rebase', '--skip'], noEditorEnv())
  if (!res.ok) {
    const state = await readRebaseState(run, cwd)
    const message = firstLine(res.stderr) || firstLine(res.stdout) || 'Could not skip.'
    throw new ApiError(409, state?.rebasing ? 'git_rebase_conflict' : 'git_rebase_failed', message)
  }
}
