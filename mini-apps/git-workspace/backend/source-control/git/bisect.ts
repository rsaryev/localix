/**
 * git bisect for the source-control backend — binary search for the
 * commit that introduced a regression. The user marks a known-BAD commit (and
 * optionally a known-GOOD one); git checks out the midpoint; each subsequent
 * mark (good / bad / skip) halves the range until the first bad commit is found.
 *
 * All git bisect subcommands print their progress on stdout — either the next
 * commit to test ("Bisecting: N revisions left to test after this (roughly M
 * steps)") or the terminal verdict ("<sha> is the first bad commit"). The pure
 * `parseBisectOutput` extracts those (unit-tested against real git output); the
 * git-running helpers describe the involved commits into `RepoCommit`s.
 *
 * State detection (`getBisectState`) is derived from git itself, so a page reload
 * mid-bisect rebuilds the banner: a session is in progress when `.git/BISECT_START`
 * exists, and `findFirstBad` replays git's own algorithm over `refs/bisect` to
 * report the culprit when the search has already concluded.
 *
 * Terms are a fixed enum (good/bad/skip), never interpolated — passed as argv, so
 * a mark can't smuggle git flags. Failures surface git's stderr verbatim under a
 * typed `git_bisect_failed` (or `git_bisect_not_running` when no session exists).
 */
import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ApiError } from '@localixai/mini-app-sdk/backend'
import type { BisectState, BisectTerm, RepoCommit } from '../contracts'
import { firstLine, type GitRunner } from './cli'
import { gitPathResolver, type GitPathResolver } from './git-paths'

// --- Pure output parser (unit-tested) ----------------------------------------

/** What a `git bisect start/good/bad/skip` invocation told us. */
export interface ParsedBisectOutput {
  /** Revisions still to test after the just-checked-out one ("N revisions left"). */
  revisionsLeft?: number
  /** Rough remaining steps ("roughly M steps"). */
  stepsLeft?: number
  /** Full sha git named as the first bad commit — set only when the search concluded. */
  firstBadSha?: string
}

const PROGRESS_RE =
  /Bisecting:\s+(\d+)\s+revisions?\s+left to test after this\s+\(roughly\s+(\d+)\s+steps?\)/
const FIRST_BAD_RE = /^([0-9a-f]{7,40})\s+is the first bad commit/m

/**
 * Parse the combined stdout+stderr of a bisect command (PURE). Recognizes the
 * progress line (revisions/steps remaining) and the terminal "<sha> is the first
 * bad commit" verdict. Anything unrecognized yields an empty result.
 */
export function parseBisectOutput(text: string): ParsedBisectOutput {
  const out: ParsedBisectOutput = {}
  const progress = text.match(PROGRESS_RE)
  if (progress) {
    out.revisionsLeft = Number.parseInt(progress[1]!, 10)
    out.stepsLeft = Number.parseInt(progress[2]!, 10)
  }
  const bad = text.match(FIRST_BAD_RE)
  if (bad) out.firstBadSha = bad[1]!
  return out
}

// --- Commit description -------------------------------------------------------

const D = '\x1f'

/** Resolve a ref to a compact `RepoCommit`, or undefined when it can't be read. */
async function describeCommit(run: GitRunner, ref: string): Promise<RepoCommit | undefined> {
  const res = await run([
    'log',
    '-1',
    `--pretty=format:%H${D}%h${D}%an${D}%ad${D}%s`,
    '--date=relative',
    ref,
  ])
  if (!res.ok) return undefined
  const [hash, shortHash, author, relativeDate, subject] = res.stdout.split(D)
  if (!hash) return undefined
  return {
    hash,
    shortHash: shortHash ?? hash.slice(0, 7),
    author: author ?? '',
    relativeDate: relativeDate ?? '',
    subject: subject ?? '',
  }
}

// --- State detection ----------------------------------------------------------

/** True when a bisect session is underway (git writes `BISECT_START` on `bisect start`). */
async function isBisecting(gitPath: GitPathResolver): Promise<boolean> {
  const p = await gitPath('BISECT_START')
  return p ? existsSync(p) : false
}

async function readFileSafe(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

type BisectRefStatus = 'new' | 'old' | 'skip'

/**
 * Replay git's own done-detection over `refs/bisect`: from the
 * bad ("new") commit, walk first-parent history; if we reach a good ("old")
 * commit without crossing an unprocessed commit, the bad commit IS the culprit.
 * Returns its full sha, or undefined when the search hasn't concluded.
 */
async function findFirstBad(run: GitRunner, gitPath: GitPathResolver): Promise<string | undefined> {
  const refsDir = await gitPath('refs/bisect')
  if (!refsDir || !existsSync(refsDir)) return undefined

  // Terms default to bad/good; a modern git also records them in BISECT_TERMS.
  let newTerm = 'bad'
  let oldTerm = 'good'
  const termsPath = await gitPath('BISECT_TERMS')
  const termsRaw = termsPath ? await readFileSafe(termsPath) : null
  if (termsRaw) {
    const [n, o] = termsRaw.split('\n')
    if (n?.trim()) newTerm = n.trim()
    if (o?.trim()) oldTerm = o.trim()
  }

  let names: string[]
  try {
    names = await readdir(refsDir)
  } catch {
    return undefined
  }

  const statusMap = new Map<string, BisectRefStatus>()
  let newHash: string | undefined
  for (const name of names) {
    const content = await readFileSafe(join(refsDir, name))
    if (!content) continue
    const hash = content.trim()
    let status: BisectRefStatus = 'skip'
    if (name === newTerm) {
      status = 'new'
      newHash = hash
    } else if (name.startsWith(`${oldTerm}-`)) {
      status = 'old'
    } else if (name.startsWith('skipped-')) {
      status = 'skip'
    }
    statusMap.set(hash, status)
  }
  if (!newHash) return undefined

  const revList = await run(['rev-list', newHash])
  if (!revList.ok) return undefined
  for (const line of revList.stdout.split('\n')) {
    const hash = line.trim()
    if (!hash) continue
    const status = statusMap.get(hash)
    if (status === undefined) return undefined // hit an unprocessed commit — not done
    if (status === 'old') return newHash // reached a good commit → the bad one is the culprit
    // 'new' or 'skip' → keep walking
  }
  return undefined
}

/**
 * Summarize the current bisect, or `undefined` when none is underway. `current`
 * is the commit checked out for testing (HEAD); `firstBadCommit` is set once the
 * search has concluded. `revisionsLeft`/`stepsLeft` are not persisted by git, so
 * they're absent on a plain status read (they ride the mark/start output instead).
 */
export async function getBisectState(
  run: GitRunner,
  cwd: string,
  gitDir?: string,
): Promise<BisectState | undefined> {
  // `gitDir` (already known by the status read) makes the not-bisecting answer —
  // by far the common one — a single `existsSync` with no git spawn at all.
  const gitPath = gitPathResolver(run, cwd, gitDir)
  if (!(await isBisecting(gitPath))) return undefined
  const [current, firstBadSha] = await Promise.all([
    describeCommit(run, 'HEAD'),
    findFirstBad(run, gitPath),
  ])
  const firstBadCommit = firstBadSha ? await describeCommit(run, firstBadSha) : undefined
  return {
    bisecting: true,
    ...(current ? { current } : {}),
    ...(firstBadCommit ? { firstBadCommit } : {}),
  }
}

/**
 * Build the post-op state: the derived `getBisectState` (current commit + any
 * concluded culprit) overlaid with the revisions/steps this specific command's
 * output reported. When the output already named the first bad commit but the
 * derived state hasn't (edge cases), describe it directly.
 */
async function stateAfter(run: GitRunner, cwd: string, output: string): Promise<BisectState> {
  const parsed = parseBisectOutput(output)
  const state = (await getBisectState(run, cwd)) ?? { bisecting: true }
  if (parsed.revisionsLeft !== undefined) state.revisionsLeft = parsed.revisionsLeft
  if (parsed.stepsLeft !== undefined) state.stepsLeft = parsed.stepsLeft
  if (!state.firstBadCommit && parsed.firstBadSha) {
    state.firstBadCommit = await describeCommit(run, parsed.firstBadSha)
  }
  return state
}

// --- Public operations --------------------------------------------------------

/**
 * Start a bisect marking `bad` as broken (and optionally `good` as working). git
 * checks out the midpoint (detaching HEAD) once both bounds are known — with only
 * `bad`, it waits for a good mark. Refs are passed as argv; git validates them.
 */
export async function bisectStart(
  run: GitRunner,
  cwd: string,
  bad: string,
  good?: string,
): Promise<BisectState> {
  // git bisect silently IGNORES an unresolvable ref (exits 0, waits for bounds),
  // so validate up front to fail with a clear message instead of a stuck session.
  for (const ref of good ? [bad, good] : [bad]) {
    const check = await run(['rev-parse', '--verify', `${ref}^{commit}`])
    if (!check.ok) {
      throw new ApiError(
        400,
        'git_bisect_failed',
        firstLine(check.stderr) || `Unknown commit: ${ref}`,
      )
    }
  }
  const args = ['bisect', 'start', bad, ...(good ? [good] : [])]
  const res = await run(args)
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_bisect_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Could not start bisect.',
    )
  }
  return stateAfter(run, cwd, `${res.stdout}\n${res.stderr}`)
}

/**
 * Mark the currently-checked-out commit `good`, `bad`, or `skip` and advance the
 * search. Returns the updated state — either the next commit to test (+ remaining
 * revisions/steps) or the concluded first-bad-commit. Refuses when no bisect is in
 * progress (`git_bisect_not_running`).
 */
export async function bisectMark(
  run: GitRunner,
  cwd: string,
  term: BisectTerm,
): Promise<BisectState> {
  if (!(await isBisecting(gitPathResolver(run, cwd)))) {
    throw new ApiError(409, 'git_bisect_not_running', 'No bisect is in progress.')
  }
  const res = await run(['bisect', term])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_bisect_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || `Could not mark ${term}.`,
    )
  }
  return stateAfter(run, cwd, `${res.stdout}\n${res.stderr}`)
}

/**
 * End the bisect and return to the original branch/HEAD (`git bisect reset`).
 * Safe — it restores the pre-bisect checkout. A no-op success when nothing is in
 * progress would still return cleanly, but we surface git's message on failure.
 */
export async function bisectReset(run: GitRunner, _cwd: string): Promise<void> {
  const res = await run(['bisect', 'reset'])
  if (!res.ok) {
    throw new ApiError(
      409,
      'git_bisect_failed',
      firstLine(res.stderr) || firstLine(res.stdout) || 'Could not reset bisect.',
    )
  }
}
