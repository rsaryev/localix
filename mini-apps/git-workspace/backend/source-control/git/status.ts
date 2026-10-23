/**
 * Working-tree status for the git backend: who changed, how, and by how much.
 * Built from two cheap reads — `git status --porcelain=v1 -b -z` (what changed)
 * and `git diff --numstat -z` (line deltas) — joined by path. The parsers are pure
 * and exported for unit testing; `collectStatus` is the only part that runs git.
 */
import type { GitRunner } from './cli'
import type { RepoChangeStatus, RepoFileChange, RepoStatus } from '../contracts'
import { computeChangeVersion } from './change-version'
import { parseNulNumstat } from './diff-capture'
import { readRebaseState } from './rebase'
import { readRepoContext } from './repo-context'
import { getBisectState } from './bisect'

interface ParsedBranch {
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
}

type ParsedFile = Omit<RepoFileChange, 'insertions' | 'deletions'>

export interface ParsedStatus extends ParsedBranch {
  files: ParsedFile[]
}

/** Parse the `## …` branch header line emitted by `status -b`. */
export function parseBranchHeader(line: string): ParsedBranch {
  const empty: ParsedBranch = { branch: null, detached: false, upstream: null, ahead: 0, behind: 0 }
  let rest = line.replace(/^## /, '').trim()
  if (rest.startsWith('HEAD (no branch)')) return { ...empty, detached: true }
  // "No commits yet on main" — an unborn branch (no commits, no upstream).
  rest = rest.replace(/^No commits yet on /, '')

  let ahead = 0
  let behind = 0
  const ab = rest.match(/\s\[(.+)\]$/)
  if (ab?.index !== undefined) {
    rest = rest.slice(0, ab.index).trim()
    const a = ab[1].match(/ahead (\d+)/)
    const b = ab[1].match(/behind (\d+)/)
    if (a) ahead = Number(a[1])
    if (b) behind = Number(b[1])
  }

  const dots = rest.indexOf('...')
  if (dots >= 0) {
    return {
      branch: rest.slice(0, dots) || null,
      detached: false,
      upstream: rest.slice(dots + 3) || null,
      ahead,
      behind,
    }
  }
  return { branch: rest || null, detached: false, upstream: null, ahead, behind }
}

/** Map a porcelain XY status pair to a VCS-neutral change kind. */
function classify(x: string, y: string): RepoChangeStatus {
  if (x === '?' && y === '?') return 'untracked'
  // Unmerged combinations (see `git status` porcelain docs).
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D'))
    return 'conflicted'
  const code = x !== ' ' && x !== '?' ? x : y
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    default:
      return 'unknown'
  }
}

/**
 * Parse `git status --porcelain=v1 -b -z`. Records are NUL-separated; the first
 * is the branch header. Rename/copy entries span two records — the path field
 * (destination) followed by a record holding the original path.
 */
export function parseStatus(raw: string): ParsedStatus {
  const parts = raw.split('\0')
  let branchInfo: ParsedBranch = {
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
  }
  const files: ParsedFile[] = []

  let i = 0
  if (parts[i]?.startsWith('## ')) {
    branchInfo = parseBranchHeader(parts[i])
    i++
  }

  for (; i < parts.length; i++) {
    const rec = parts[i]
    if (!rec) continue
    const x = rec[0] ?? ' '
    const y = rec[1] ?? ' '
    const path = rec.slice(3)
    let oldPath: string | undefined
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      // The original path is the next record; consume it.
      oldPath = parts[i + 1] || undefined
      i++
    }
    const status = classify(x, y)
    files.push({
      path,
      oldPath,
      status,
      // An unmerged index is neither a normal staged diff nor a normal
      // worktree diff. It contains up to three index stages (base/ours/theirs)
      // and must be surfaced in its own Merge Changes group. Treating `UU` as
      // both staged and unstaged made the UI request an empty `diff --cached`
      // and rendered the same conflict twice.
      staged: status === 'conflicted' ? false : x !== ' ' && x !== '?',
      unstaged:
        status === 'conflicted' ? false : (y !== ' ' && y !== '?') || (x === '?' && y === '?'),
    })
  }

  return { ...branchInfo, files }
}

/**
 * Parse `git diff --numstat -z` into a path→delta map keyed like porcelain status.
 *
 * The NUL form is required, not a style choice. Without `-z` git C-quotes any path outside plain
 * ASCII (`"\321\204\320\260.txt"`, under the default `core.quotePath`) and prints a rename as
 * `old => new` or `dir/{old => new}/f`, while `status -z` names the same files raw — so the join by
 * path missed and every non-ASCII or renamed file showed +0/-0. The record parser is the one
 * `diff-capture.ts` already uses for its manifest; binary files count as 0.
 */
export function parseNumstat(
  raw: string,
): Map<string, Pick<RepoFileChange, 'insertions' | 'deletions' | 'binary'>> {
  const map = new Map<string, Pick<RepoFileChange, 'insertions' | 'deletions' | 'binary'>>()
  for (const { path, insertions, deletions, binary } of parseNulNumstat(raw)) {
    map.set(path, { insertions, deletions, ...(binary ? { binary } : {}) })
  }
  return map
}

/** No changed paths → no deltas to join. Shared so the clean path allocates nothing. */
const NO_DELTAS: ReadonlyMap<
  string,
  Pick<RepoFileChange, 'insertions' | 'deletions' | 'binary'>
> = new Map()

/**
 * Run git and assemble the joined `RepoStatus`. `cwd` is optional — when given,
 * an in-progress rebase (conflict/stop) is detected and reported on `.rebase`, and
 * an in-progress bisect on `.bisect`, so the header can surface their banners.
 *
 * PROCESS BUDGET. This is the hottest read in the mini app: the poller runs it for
 * every discovered repo on every tick, and each git spawn costs ~10 ms whatever
 * it is asked. So it issues the fewest it can:
 *
 *  - the root, the `.git` dir and HEAD's sha come from ONE `rev-parse`
 *    ({@link readRepoContext}) instead of three scattered ones — and knowing the
 *    git dir turns the rebase/bisect probes into `existsSync` calls;
 *  - the line-delta, index-identity and metadata-hash work is SKIPPED entirely
 *    on a clean tree. Every staged or worktree change (including an intent-to-add)
 *    appears in porcelain status, so "no entries" provably means an empty
 *    `--numstat` and an empty `diff --cached --raw` — computing them would only
 *    confirm it.
 *
 * A clean repo therefore costs 2 spawns and a dirty one 4, where it used to cost
 * 8 either way.
 */
export async function collectStatus(run: GitRunner, cwd?: string): Promise<RepoStatus> {
  const [statusRes, context] = await Promise.all([
    // `-uall` expands untracked DIRECTORIES into their individual files. Without it
    // git collapses an untracked folder to a single `docs/` entry (trailing slash),
    // which the UI's path→tree builder would split into a nameless leaf node.
    //
    // GIT_OPTIONAL_LOCKS=0: a plain `git status` takes the index lock and REWRITES `.git/index`
    // whenever it refreshes stale stat data (a touched but unchanged file). The panel now
    // refreshes on the workspace watcher's signal, which reports `.git`, so that write was a
    // change event of its own making — every read scheduled the next one. A read must not write;
    // it also stops this background poll from contending with the person's own `git` for the
    // lock (the reason git grew the variable).
    run(['status', '--porcelain=v1', '-b', '-z', '-uall'], { GIT_OPTIONAL_LOCKS: '0' }),
    readRepoContext(run),
  ])
  const parsed = parseStatus(statusRes.ok ? statusRes.stdout : '')
  const dirty = parsed.files.length > 0
  const gitDir = context.gitDir ?? undefined
  const [deltas, indexState, rebase, bisect] = await Promise.all([
    dirty ? collectNumstat(run, context.head !== null) : NO_DELTAS,
    // Porcelain XY flags say that a path is staged, but not WHICH partial hunks
    // are staged. The raw cached diff includes blob identities without source
    // content, so it catches index-only changes that leave file mtime and line
    // counts unchanged (and therefore must invalidate commit suggestions).
    dirty && cwd
      ? run(['diff', '--cached', '--raw', '-z']).then((result) => (result.ok ? result.stdout : ''))
      : '',
    cwd ? readRebaseState(run, cwd, gitDir).catch(() => undefined) : undefined,
    cwd ? getBisectState(run, cwd, gitDir).catch(() => undefined) : undefined,
  ])

  const files: RepoFileChange[] = parsed.files.map((f) => {
    const d = deltas.get(f.path) ?? { insertions: 0, deletions: 0 }
    return { ...f, ...d }
  })
  // Still computed on a clean tree: with no files it is a pure hash of the empty
  // index state (no filesystem reads), and consumers rely on it being present.
  const changeVersion = cwd ? await computeChangeVersion(cwd, files, indexState) : undefined

  return {
    root: context.root,
    head: context.head,
    branch: parsed.branch,
    detached: parsed.detached,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    files,
    stats: {
      files: files.length,
      insertions: files.reduce((s, f) => s + f.insertions, 0),
      deletions: files.reduce((s, f) => s + f.deletions, 0),
    },
    ...(changeVersion ? { changeVersion } : {}),
    ...(rebase ? { rebase } : {}),
    ...(bisect ? { bisect } : {}),
  }
}

/**
 * Line deltas for every tracked change vs the committed tree. Uses `diff HEAD`
 * (staged + unstaged in one pass, no double counting) when there is a commit,
 * falling back to `diff --cached` on an unborn branch. Untracked files aren't
 * included here — they show as 0/0, which the UI renders as a plain "new" file.
 * `hasHead` is passed in rather than probed: the caller already resolved it.
 */
async function collectNumstat(
  run: GitRunner,
  hasHead: boolean,
): Promise<Map<string, Pick<RepoFileChange, 'insertions' | 'deletions' | 'binary'>>> {
  const res = await run(
    hasHead ? ['diff', 'HEAD', '--numstat', '-z'] : ['diff', '--cached', '--numstat', '-z'],
  )
  return parseNumstat(res.ok ? res.stdout : '')
}
