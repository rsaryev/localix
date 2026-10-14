/**
 * Commit provenance via git notes (`refs/notes/localix`). This extends the
 * "git is the source of truth" model: when a commit is made through OUR commit
 * path, we attach a namespaced git note recording who/what produced it — no
 * side DB table. The note lives IN git, travels with the repo, and is invisible
 * to plain `git log` (only `git log --notes=localix` reveals it).
 *
 * Everything here is BEST-EFFORT: a failed note write must NEVER fail or roll
 * back the user's actual commit, so `writeCommitNote` swallows errors. The
 * `gitRunner` it consumes never throws (a non-zero exit resolves `ok:false`).
 */
import type { CommitNote } from '../contracts'
import type { GitRunner } from './cli'
import { isSafeRef } from './ref'

/** The namespaced notes ref — keeps these notes out of `git log` / fetch defaults. */
export const LOCALIX_NOTES_REF = 'refs/notes/localix'
const NOTES_REF_ARG = '--ref=localix'

/**
 * Idempotently configure note copying across rewrites so rebase/amend don't
 * orphan our notes:
 *   - `notes.rewriteRef` must CONTAIN `refs/notes/localix` (append, don't clobber
 *     a user's existing value — `--get-all` then add only if absent).
 *   - `notes.rewriteMode=concatenate` (overwrite is fine to set; it's our policy).
 * Best-effort — a failure just means notes won't auto-copy on rewrite. Resolves
 * true once both settings are in place.
 */
export async function applyNotesRewriteConfig(run: GitRunner): Promise<boolean> {
  const existing = await run(['config', '--get-all', 'notes.rewriteRef'])
  const refs = existing.ok
    ? existing.stdout
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : []
  const added = refs.includes(LOCALIX_NOTES_REF)
    ? true
    : (await run(['config', '--add', 'notes.rewriteRef', LOCALIX_NOTES_REF])).ok
  const mode = await run(['config', 'notes.rewriteMode', 'concatenate'])
  return added && mode.ok
}

/**
 * Repos whose rewrite config is known to be in place, for this process's lifetime.
 * Without it every commit paid 2–3 `git config` spawns to re-confirm settings that
 * only this code writes. A failed apply is forgotten, so the next commit retries.
 */
const configuredRepos = new Map<string, Promise<boolean>>()

/** {@link applyNotesRewriteConfig} at most once per repo (concurrent callers share one run). */
export async function ensureNotesRewriteConfig(run: GitRunner, repo: string): Promise<void> {
  let pending = configuredRepos.get(repo)
  if (!pending) {
    pending = applyNotesRewriteConfig(run)
    configuredRepos.set(repo, pending)
  }
  if (!(await pending)) configuredRepos.delete(repo)
}

/**
 * Attach the provenance note to `sha` on `refs/notes/localix`. `-f` overwrites
 * any existing note; `-m` supplies the JSON inline so git never opens an editor.
 * Strictly best-effort: invalid ref or any git failure is swallowed.
 */
export async function writeCommitNote(
  run: GitRunner,
  sha: string,
  payload: CommitNote,
): Promise<void> {
  if (!isSafeRef(sha)) return
  try {
    await run(['notes', NOTES_REF_ARG, 'add', '-f', '-m', JSON.stringify(payload), sha])
  } catch {
    /* best-effort — never let provenance break a commit */
  }
}

/**
 * Read the provenance note for `sha`, or null when there is none / it doesn't
 * parse as a `CommitNote`. `git notes show` exits non-zero when no note exists.
 */
export async function readCommitNote(run: GitRunner, sha: string): Promise<CommitNote | null> {
  if (!isSafeRef(sha)) return null
  const res = await run(['notes', NOTES_REF_ARG, 'show', sha])
  if (!res.ok) return null
  try {
    const parsed = JSON.parse(res.stdout.trim()) as CommitNote
    if (parsed && typeof parsed === 'object' && 'createdAt' in parsed) return parsed
    return null
  } catch {
    return null
  }
}

/** Resolve `HEAD` to a full commit sha; null when it can't be resolved. */
export async function resolveHead(run: GitRunner): Promise<string | null> {
  const res = await run(['rev-parse', '--verify', 'HEAD'])
  if (!res.ok) return null
  return res.stdout.trim() || null
}

/**
 * The set of full commit shas that carry a localix note. `git notes list` prints
 * "<noteBlobSha> <commitSha>" lines; we take the 2nd column. One git call total
 * (the log read sets `hasNote` from this set rather than probing per-commit).
 * Empty set on any error.
 */
export async function listNotedCommits(run: GitRunner): Promise<Set<string>> {
  const res = await run(['notes', NOTES_REF_ARG, 'list'])
  if (!res.ok) return new Set()
  const shas = new Set<string>()
  for (const line of res.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/)
    const commitSha = parts[1]
    if (commitSha) shas.add(commitSha)
  }
  return shas
}
