/**
 * How every source-control operation reaches a repository: resolve the session's
 * cwd, find (and memoize) the backend that owns it, and wrap the op in the read,
 * degrading-read or serialized-write shape it needs. The operation groups
 * (`reads.ts`, `tree-writes.ts`, `ref-writes.ts`) take this as their one dep.
 */
import { ApiError } from '@localixai/mini-app-sdk/backend'
import { createWriteSerializer, retryOnLockContention } from '../support/write-serial'
import type {
  SourceControlBranches,
  SourceControlMutation,
  SourceControlStatus,
} from '../contracts'
import type { ResolveBackend, ResolveCwd, SourceControlBackend } from '../ports'

export const emptyBranches = (): SourceControlBranches => ({
  isRepo: false,
  vcs: null,
  current: null,
  branches: [],
  remotes: [],
})

/** `unresolved`: no directory to ask about yet — a pending answer, not a "not a repo" verdict. */
export const emptyStatus = (unresolved = false): SourceControlStatus => ({
  ...(unresolved ? { unresolved: true } : {}),
  isRepo: false,
  vcs: null,
  root: null,
  branch: null,
  detached: false,
  upstream: null,
  ahead: 0,
  behind: 0,
  files: [],
  stats: { files: 0, insertions: 0, deletions: 0 },
})

/**
 * What each write invalidates BESIDES the status. Passing this is what lets the
 * response stand alone: the UI applies it and re-reads nothing.
 */
export interface MutationScope {
  /** Branch identity / ahead-behind could have moved (checkout, commit, push, rebase…). */
  branches?: boolean
  /** The stash stack could have changed. */
  stashes?: boolean
}

export type RepoOp<T> = (backend: SourceControlBackend, cwd: string) => Promise<T>

export function createRepoAccess(deps: { resolveCwd: ResolveCwd; resolveBackend: ResolveBackend }) {
  /**
   * Which backend owns a directory, memoized per cwd.
   *
   * Resolving it costs a `git rev-parse --is-inside-work-tree` — one spawn on
   * EVERY request, asking a question whose answer changes about as often as the
   * directory is created. Only POSITIVE answers are cached: a `git init` in a
   * directory that was not a repo a moment ago must show up at once, while a
   * repo that stops being one is rare enough to tolerate a few stale seconds.
   */
  const BACKEND_MEMO_TTL_MS = 30_000
  const backendMemo = new Map<string, { at: number; backend: SourceControlBackend }>()

  async function backendFor(cwd: string): Promise<SourceControlBackend | null> {
    const hit = backendMemo.get(cwd)
    if (hit && Date.now() - hit.at < BACKEND_MEMO_TTL_MS) return hit.backend
    const backend = await deps.resolveBackend(cwd)
    if (backend) backendMemo.set(cwd, { at: Date.now(), backend })
    else backendMemo.delete(cwd)
    return backend
  }

  async function resolve(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<{ cwd: string; backend: SourceControlBackend } | null> {
    const cwd = await deps.resolveCwd(userId, sessionId, repoRoot)
    if (!cwd) return null
    const backend = await backendFor(cwd)
    return backend ? { cwd, backend } : null
  }

  /** Resolve to a backend or fail — for write/diff ops that need a real repo. */
  async function requireRepo(
    userId: string,
    sessionId: string | null,
    repoRoot?: string,
  ): Promise<{ cwd: string; backend: SourceControlBackend }> {
    const resolved = await resolve(userId, sessionId, repoRoot)
    if (!resolved)
      throw new ApiError(404, 'not_a_repo', 'No version-control repository for this session.')
    return resolved
  }

  const withEnvelope = (
    backend: SourceControlBackend,
    status: Awaited<ReturnType<SourceControlBackend['getStatus']>>,
  ): SourceControlStatus => ({
    isRepo: true,
    vcs: backend.id,
    ...status,
  })

  /**
   * The branch envelope: local branches plus the remote ones with no local
   * counterpart. Both reads are issued TOGETHER and joined here — the filter
   * needs the local names, but the remote listing does not, and making it wait
   * would put a serial git spawn on the panel's hottest read.
   */
  async function readBranches(
    backend: SourceControlBackend,
    cwd: string,
  ): Promise<SourceControlBranches> {
    const [branches, allRemotes] = await Promise.all([
      backend.listBranches(cwd),
      // Degrades to an empty list: a repo with no remote is normal, not an error.
      backend.listRemoteBranches(cwd).catch(() => []),
    ])
    const local = new Set(branches.map((b) => b.name))
    return {
      isRepo: true,
      vcs: backend.id,
      current: branches.find((b) => b.current)?.name ?? null,
      branches,
      remotes: allRemotes.filter((remote) => !local.has(remote.shortName)),
    }
  }

  /** One write at a time per repository (see `write-serial.ts`). */
  const serialize = createWriteSerializer()

  /**
   * The shape EVERY write shares: demand a real repo (404 when there is none),
   * run the op serialized against other writes to the same tree, and answer with
   * the refreshed state the op invalidated — that answer is what the UI treats as
   * truth, so no caller re-reads. This was spelled out in ~30 methods; it has one
   * definition.
   *
   * A write that lost a race for `index.lock` against a git we do not control is
   * retried a couple of times: the losing process usually holds the lock for
   * milliseconds, and a retry is far better than telling the user their click
   * failed. Nothing else is retried — a rejected push or a conflicted merge is an
   * answer, not a hiccup.
   */
  async function mutate(
    userId: string,
    sessionId: string | null,
    repoRoot: string | undefined,
    op: RepoOp<unknown>,
    scope: MutationScope = {},
  ): Promise<SourceControlMutation> {
    const { cwd, backend } = await requireRepo(userId, sessionId, repoRoot)
    return serialize(cwd, async () => {
      await retryOnLockContention(() => op(backend, cwd))
      const [status, branches, stashes] = await Promise.all([
        backend.getStatus(cwd),
        scope.branches ? readBranches(backend, cwd) : undefined,
        scope.stashes ? backend.listStashes(cwd).catch(() => []) : undefined,
      ])
      return {
        status: withEnvelope(backend, status),
        ...(branches ? { branches } : {}),
        ...(stashes ? { stashes } : {}),
      }
    })
  }

  /** A read that needs a real repo: resolve-or-404, then delegate. */
  async function read<T>(
    userId: string,
    sessionId: string | null,
    repoRoot: string | undefined,
    op: RepoOp<T>,
  ): Promise<T> {
    const { cwd, backend } = await requireRepo(userId, sessionId, repoRoot)
    return op(backend, cwd)
  }

  /**
   * A read that DEGRADES rather than fails: not a repo, or the backend threw →
   * `fallback`. These are the garnish reads (blame, provenance note, stash list,
   * message recall) — a repo-less project must leave the view intact, not 404 it.
   */
  async function readOr<T>(
    userId: string,
    sessionId: string | null,
    repoRoot: string | undefined,
    fallback: T,
    op: RepoOp<T>,
  ): Promise<T> {
    const resolved = await resolve(userId, sessionId, repoRoot)
    if (!resolved) return fallback
    return op(resolved.backend, resolved.cwd).catch(() => fallback)
  }

  return { backendFor, resolve, requireRepo, withEnvelope, readBranches, mutate, read, readOr }
}

export type RepoAccess = ReturnType<typeof createRepoAccess>
