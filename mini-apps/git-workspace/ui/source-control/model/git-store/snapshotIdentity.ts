/**
 * Decide whether a freshly polled payload says anything new — in O(1) for the
 * common case — and keep the cached reference when it does not.
 *
 * The defect this replaces: every poll tick serialised the cached AND the fresh
 * status and repo inventory with `JSON.stringify` to compare them. At 5,000
 * changed files that is several megabytes of string built and thrown away every
 * few seconds, per session, for a tick that almost always changed nothing. The
 * wire also carries the focused repo's status twice (once in `repos`, once as
 * `status`), so the work was doubled.
 *
 * What makes an O(1) compare sound is `changeVersion`: the backend
 * (`git/change-version.ts`) hashes every changed path's path/oldPath/status/
 * staged/unstaged flags plus its lstat metadata (size, mtime, ctime, inode,
 * mode) and the staged index identity. A content edit moves mtime; a staging
 * change moves the index identity; a path appearing or vanishing changes the
 * path set. So equal `changeVersion`s mean an equal file list, and only the
 * branch-level scalars (branch, upstream, ahead/behind, rebase, bisect) — which
 * the hash does not cover — are compared beside it. The per-file line counts are
 * a function of the same content and of HEAD; HEAD moving without any changed
 * path's metadata or the index moving leaves them equal, and the aggregate
 * `stats` are compared anyway as a guard.
 *
 * A backend that sends no `changeVersion` falls back to a field-by-field walk of
 * the file list — still linear, but allocation-free.
 */
import type {
  RepoFileChange,
  RepoWithStatus,
  SourceControlStatus,
} from '../../../../backend/source-control/contracts'

/** Structural equality for small plain-JSON values (branches, stashes, rebase/bisect state). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const other = b as unknown[]
    if (a.length !== other.length) return false
    for (let i = 0; i < a.length; i++) if (!sameJson(a[i], other[i])) return false
    return true
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) if (!sameJson(left[key], right[key])) return false
  return true
}

function sameFile(a: RepoFileChange, b: RepoFileChange): boolean {
  return (
    a.path === b.path &&
    a.oldPath === b.oldPath &&
    a.status === b.status &&
    a.staged === b.staged &&
    a.unstaged === b.unstaged &&
    a.insertions === b.insertions &&
    a.deletions === b.deletions
  )
}

function sameFiles(a: RepoFileChange[], b: RepoFileChange[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (!sameFile(a[i]!, b[i]!)) return false
  return true
}

/** True when two status envelopes describe the same working tree. O(1) when both carry a `changeVersion`. */
export function sameStatus(
  a: SourceControlStatus | null | undefined,
  b: SourceControlStatus | null | undefined,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const scalarsEqual =
    a.isRepo === b.isRepo &&
    a.vcs === b.vcs &&
    a.unresolved === b.unresolved &&
    a.root === b.root &&
    // HEAD is outside `changeVersion`: a commit that leaves every changed path's metadata
    // alone would otherwise keep the cached status — and its stale sha — forever.
    a.head === b.head &&
    a.branch === b.branch &&
    a.detached === b.detached &&
    a.upstream === b.upstream &&
    a.ahead === b.ahead &&
    a.behind === b.behind &&
    a.changeVersion === b.changeVersion &&
    a.files.length === b.files.length &&
    a.stats.files === b.stats.files &&
    a.stats.insertions === b.stats.insertions &&
    a.stats.deletions === b.stats.deletions &&
    sameJson(a.rebase, b.rebase) &&
    sameJson(a.bisect, b.bisect)
  if (!scalarsEqual) return false
  return a.changeVersion !== undefined ? true : sameFiles(a.files, b.files)
}

/**
 * Reconcile a fresh repo inventory against the cached one, row by row: an
 * unchanged repo keeps its cached object (so a memo keyed on one repo's status
 * survives another repo's edit), and an entirely unchanged inventory returns the
 * cached ARRAY itself.
 */
export function keepRepos(prev: RepoWithStatus[], next: RepoWithStatus[]): RepoWithStatus[] {
  const byRoot = new Map(prev.map((repo) => [repo.root, repo]))
  const merged = next.map((repo) => {
    const cached = byRoot.get(repo.root)
    return cached &&
      cached.name === repo.name &&
      cached.isPrimary === repo.isPrimary &&
      sameStatus(cached.status, repo.status)
      ? cached
      : repo
  })
  const unchanged = merged.length === prev.length && merged.every((repo, i) => repo === prev[i])
  return unchanged ? prev : merged
}

/**
 * The focused status, sharing ONE object with its row in the inventory.
 *
 * The workspace read sends the focused repo's status twice; reconciled
 * separately, the two copies became two objects, so the inventory row and the
 * panel status disagreed on identity and every consumer keyed on either one
 * recomputed for the other. The cached focused status wins when it is still
 * equal; otherwise the (already reconciled) inventory row is reused.
 */
export function keepFocusedStatus(
  prev: SourceControlStatus | null,
  next: SourceControlStatus,
  repos: RepoWithStatus[],
): SourceControlStatus {
  if (sameStatus(prev, next)) return prev!
  const row = next.root ? repos.find((repo) => repo.root === next.root) : undefined
  return row && sameStatus(row.status, next) ? row.status : next
}
