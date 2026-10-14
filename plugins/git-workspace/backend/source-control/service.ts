/**
 * Source-control orchestration. VCS-agnostic: it resolves a session's working
 * directory, asks the backend resolver which backend owns it, and delegates.
 * When no backend claims the directory (not a repo, or unresolved cwd) reads
 * return an empty/"not a repo" envelope and writes 404 — callers never see a
 * throw for the common "this project isn't a repo" case.
 *
 * Multi-root: every method takes an optional trailing `repoRoot` naming which
 * repository of a multi-repo project the op targets. It threads to
 * `deps.resolveCwd`, which validates it against the session's discovered repos
 * and falls back to the primary repo when absent/unknown. Omitting it preserves
 * the single-repo behaviour exactly.
 */
import { ApiError } from '@localixai/plugin-sdk/backend'
import { defaultGitInstalled, GIT_PREREQUISITE } from './git-prerequisite'
import type {
  BlameLine,
  CommitNote,
  RepoStash,
  RepoWithStatus,
  SourceControlBranches,
  SourceControlMutation,
  SourceControlStatus,
} from './contracts'
import type { ResolveBackend, ResolveCwd, SourceControlBackend } from './ports'

/**
 * Optional: resolve the session metadata recorded in a commit's provenance note
 * (model + agent mode). Kept as an injected callback so the service stays
 * VCS-neutral and never imports chat internals. Null/absent → the note still
 * carries `{ sessionId, createdAt }`, just without the richer fields.
 */
export type ResolveCommitNoteMeta = (input: {
  userId: string
  sessionId: string
}) => Promise<{ model?: string; rationale?: string } | null>

/**
 * Optional: list every repository discovered for a session (multi-root), each
 * with its full status. Injected (from the repo-workspace service) so this
 * service stays free of filesystem-scan concerns. Absent → single-repo only.
 */
export type ListRepoStatuses = (
  userId: string,
  sessionId: string | null,
) => Promise<RepoWithStatus[]>

export interface SourceControlServiceDeps {
  resolveCwd: ResolveCwd
  resolveBackend: ResolveBackend
  /** Optional: enrich the commit provenance note with the session's model. */
  resolveCommitNoteMeta?: ResolveCommitNoteMeta
  /** Optional: enumerate the session's repos with status (multi-root view). */
  listRepoStatuses?: ListRepoStatuses
  /** Is `git` on this machine — "no repository" may mean it is not (`git-prerequisite.ts`). */
  gitInstalled?: () => boolean
}

/**
 * The service's own contract lives beside this file — ~370 lines of signatures
 * that describe the port, not the machinery. Imported for the factory's return
 * type and re-exported so every importer still reads `from './service'`.
 */
import type { SourceControlService } from './service-contract'
export type { SourceControlService }

const emptyBranches = (): SourceControlBranches => ({
  isRepo: false,
  vcs: null,
  current: null,
  branches: [],
  remotes: [],
})

/** `unresolved`: no directory to ask about yet — a pending answer, not a "not a repo" verdict. */
const emptyStatus = (unresolved = false): SourceControlStatus => ({
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

export function createSourceControlService(deps: SourceControlServiceDeps): SourceControlService {
  const gitInstalled = deps.gitInstalled ?? defaultGitInstalled
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

  /**
   * One write at a time per repository.
   *
   * git guards its index with `index.lock` and simply FAILS the loser, so two
   * overlapping writes in the same tree — a click while another click is still
   * running, staging a file while a commit is mid-flight — surfaced to the user
   * as a spurious "Could not stage" rather than as the queueing they expected.
   * Serializing per cwd makes concurrent UI actions queue instead of collide.
   * Keyed by cwd, so different repos of a multi-root project stay parallel.
   */
  const writeQueue = new Map<string, Promise<unknown>>()

  function serialize<T>(cwd: string, run: () => Promise<T>): Promise<T> {
    const prior = writeQueue.get(cwd) ?? Promise.resolve()
    // `.then(run, run)` — a failed predecessor must still release the queue.
    const next = prior.then(run, run)
    // The copy parked in the map only ORDERS the next write, so it must never
    // reject (an unobserved rejection would surface as an unhandled one) and must
    // never carry the result (which would pin it in memory until the next write).
    const parked = next.then(
      () => undefined,
      () => undefined,
    )
    writeQueue.set(cwd, parked)
    // Only the current tail clears the entry: a writer that queued behind this
    // one has already replaced it, and dropping that would unserialize them.
    void parked.then(() => {
      if (writeQueue.get(cwd) === parked) writeQueue.delete(cwd)
    })
    return next
  }

  /** Lock contention from a git we do NOT control (an agent, a terminal, a hook). */
  const LOCK_CONTENTION = /index\.lock|Another git process|unable to create.*\.lock/i
  const LOCK_RETRIES = 2
  const LOCK_BACKOFF_MS = 120

  /**
   * What each write invalidates BESIDES the status. Passing this is what lets the
   * response stand alone: the UI applies it and re-reads nothing.
   */
  interface MutationScope {
    /** Branch identity / ahead-behind could have moved (checkout, commit, push, rebase…). */
    branches?: boolean
    /** The stash stack could have changed. */
    stashes?: boolean
  }

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
    op: (backend: SourceControlBackend, cwd: string) => Promise<unknown>,
    scope: MutationScope = {},
  ): Promise<SourceControlMutation> {
    const { cwd, backend } = await requireRepo(userId, sessionId, repoRoot)
    return serialize(cwd, async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await op(backend, cwd)
          break
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (attempt >= LOCK_RETRIES || !LOCK_CONTENTION.test(message)) throw err
          await new Promise((r) => setTimeout(r, LOCK_BACKOFF_MS * (attempt + 1)))
        }
      }
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
    op: (backend: SourceControlBackend, cwd: string) => Promise<T>,
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
    op: (backend: SourceControlBackend, cwd: string) => Promise<T>,
  ): Promise<T> {
    const resolved = await resolve(userId, sessionId, repoRoot)
    if (!resolved) return fallback
    return op(resolved.backend, resolved.cwd).catch(() => fallback)
  }

  /**
   * Best-effort provenance: attach a localix git note to the current HEAD after a
   * commit/amend. A failure here must NEVER surface — the user's commit already
   * succeeded (the note is a nicety, not the source of truth).
   */
  async function annotateHead(
    backend: SourceControlBackend,
    cwd: string,
    userId: string,
    sessionId: string | null,
    message: string,
  ): Promise<void> {
    try {
      const sha = await backend.resolveHead(cwd)
      if (!sha) return
      const meta =
        sessionId && deps.resolveCommitNoteMeta
          ? await deps.resolveCommitNoteMeta({ userId, sessionId }).catch(() => null)
          : null
      const note: CommitNote = {
        sessionId,
        createdAt: new Date().toISOString(),
        ...(meta?.model ? { model: meta.model } : {}),
        // Default rationale = the commit subject (first line) when none given.
        rationale: meta?.rationale ?? (message.split('\n')[0]?.trim() || undefined),
      }
      await backend.writeCommitNote(cwd, sha, note)
    } catch {
      /* provenance is best-effort — swallow */
    }
  }

  return {
    async listRepos(userId, sessionId) {
      if (!deps.listRepoStatuses) return []
      return deps.listRepoStatuses(userId, sessionId)
    },

    // Reads that answer for a NON-repo too: the Source Control view renders an
    // "not a repository" state rather than an error, so these resolve leniently.
    async getStatus(userId, sessionId, repoRoot) {
      const cwd = await deps.resolveCwd(userId, sessionId, repoRoot)
      const backend = cwd ? await backendFor(cwd) : null
      if (!cwd) return emptyStatus(true)
      if (!backend)
        return gitInstalled() ? emptyStatus() : { ...emptyStatus(), prerequisite: GIT_PREREQUISITE }
      return withEnvelope(backend, await backend.getStatus(cwd))
    },

    async getBranches(userId, sessionId, repoRoot) {
      const resolved = await resolve(userId, sessionId, repoRoot)
      if (!resolved) return emptyBranches()
      return readBranches(resolved.backend, resolved.cwd)
    },

    async getWorkspace(userId, sessionId, repoRoot) {
      // Issued together: the filesystem scan and the caller's own focus do not
      // depend on each other, and the panel polls this — a serial wave here is a
      // wave on every tick.
      const [repos, hinted] = await Promise.all([
        deps.listRepoStatuses
          ? deps.listRepoStatuses(userId, sessionId).catch(() => [])
          : Promise.resolve([] as RepoWithStatus[]),
        resolve(userId, sessionId, repoRoot),
      ])
      // Honour the caller's focus while it still exists; otherwise fall back the
      // same way the panel would — primary repo, then whatever was found.
      const requested = repoRoot && repos.some((r) => r.root === repoRoot) ? repoRoot : undefined
      const activeRepo =
        requested ?? repos.find((r) => r.isPrimary)?.root ?? repos[0]?.root ?? repoRoot ?? null
      // The speculative resolve is reusable exactly when it landed on the repo we
      // settled on — which is the ordinary case (a focus that still exists, or a
      // single-repo project). Anything else pays for the re-resolve it needs.
      let resolved =
        hinted?.cwd === activeRepo
          ? hinted
          : await resolve(userId, sessionId, activeRepo ?? undefined)
      // A scoped resolve fails closed on an unknown root — right for a write, too
      // harsh for the panel's poll: a repo that has just been removed (or a scan
      // that came back empty) would blank the whole view. Fall back to the
      // session's own working dir, which is what a single-repo project uses.
      if (!resolved && activeRepo) resolved = await resolve(userId, sessionId, undefined)
      if (!resolved) {
        // A discovered repo proves the directory resolved; otherwise ask whether it did at all.
        const unresolved = repos.length === 0 && !(await deps.resolveCwd(userId, sessionId))
        return {
          repos,
          activeRepo: null,
          status: emptyStatus(unresolved),
          branches: emptyBranches(),
          stashes: [],
        }
      }
      // Discovery already ran a full status for every repo it found, and the
      // envelope it stores is the same one `getStatus` builds. Reusing it is what
      // removes the second `git status` of the focused repo per poll — and with
      // it the window where the repo list and the file panel disagreed because
      // they described two different snapshots of one tree.
      const discovered = repos.find((r) => r.root === resolved.cwd)?.status
      const [status, branches, stashes] = await Promise.all([
        discovered ??
          resolved.backend
            .getStatus(resolved.cwd)
            .then((raw) => withEnvelope(resolved.backend, raw)),
        readBranches(resolved.backend, resolved.cwd),
        resolved.backend.listStashes(resolved.cwd).catch(() => [] as RepoStash[]),
      ])
      return { repos, activeRepo: status.root ?? resolved.cwd, status, branches, stashes }
    },

    async getLog(userId, sessionId, limit = 30, filter, repoRoot) {
      const resolved = await resolve(userId, sessionId, repoRoot)
      if (!resolved) return []
      // One extra git call total (not per-commit) to badge noted commits.
      const [commits, noted] = await Promise.all([
        resolved.backend.getLog(resolved.cwd, limit, filter),
        resolved.backend.listNotedCommits(resolved.cwd).catch(() => new Set<string>()),
      ])
      if (noted.size === 0) return commits
      return commits.map((c) => (noted.has(c.hash) ? { ...c, hasNote: true } : c))
    },

    // Diffs — a real repo is required (404 otherwise).
    getRangeDiff: (userId, sessionId, from, to, threeDot, repoRoot) =>
      read(userId, sessionId, repoRoot, (b, cwd) => b.getRangeDiff(cwd, from, to, threeDot)),

    getFileDiff: (userId, sessionId, input, repoRoot) =>
      read(userId, sessionId, repoRoot, (b, cwd) => b.getFileDiff(cwd, input)),

    getWorkingDiff: (userId, sessionId, repoRoot) =>
      read(userId, sessionId, repoRoot, (b, cwd) => b.getWorkingDiff(cwd)),

    getFileHunks: (userId, sessionId, path, repoRoot) =>
      read(userId, sessionId, repoRoot, (b, cwd) => b.getFileHunks(cwd, path)),

    getFileDiffLines: (userId, sessionId, input, repoRoot) =>
      read(userId, sessionId, repoRoot, (b, cwd) => b.getFileDiffLines(cwd, input)),

    getCommitShow: (userId, sessionId, hash, repoRoot) =>
      read(userId, sessionId, repoRoot, (b, cwd) => b.getCommitShow(cwd, hash)),

    getStashDiff: (userId, sessionId, index, repoRoot) =>
      read(userId, sessionId, repoRoot, (b, cwd) => b.showStash(cwd, index)),

    // Decoration reads — degrade to a neutral value instead of failing the view.
    getBlame: (userId, sessionId, file, range, repoRoot) =>
      readOr<BlameLine[]>(userId, sessionId, repoRoot, [], (b, cwd) => b.blame(cwd, file, range)),

    getCommitNote: (userId, sessionId, hash, repoRoot) =>
      readOr<CommitNote | null>(userId, sessionId, repoRoot, null, (b, cwd) =>
        b.readCommitNote(cwd, hash),
      ),

    getHeadCommitMessage: (userId, sessionId, repoRoot) =>
      readOr<string | null>(userId, sessionId, repoRoot, null, (b, cwd) =>
        b.getHeadCommitMessage(cwd),
      ),

    getRecentCommitMessages: (userId, sessionId, limit = 20, repoRoot) =>
      readOr<string[]>(userId, sessionId, repoRoot, [], (b, cwd) =>
        b.getRecentCommitMessages(cwd, limit),
      ),

    async getCommitCompletionContext(userId, sessionId, repoRoot, signal) {
      if (signal?.aborted) return null
      const resolved = await resolve(userId, sessionId, repoRoot)
      if (!resolved || signal?.aborted) return null
      try {
        const [{ diff, stat, staged }, status, recentMessages] = await Promise.all([
          resolved.backend.getCommitDiff(resolved.cwd, signal),
          resolved.backend.getStatus(resolved.cwd, signal),
          resolved.backend.getRecentCommitMessages(resolved.cwd, 5, signal),
        ])
        if (signal?.aborted) return null
        const files = status.files.filter((file) => (staged ? file.staged : file.unstaged))
        // An empty untracked file has no textual `git diff --no-index` body, but it
        // is still part of the exact commit-all scope and its path can carry the
        // whole intent (for example `.gitkeep`). Keep the inventory-only context;
        // return null only when there is genuinely no commit candidate.
        if (files.length === 0 && !diff.trim()) return null
        return {
          branch: status.branch,
          files,
          stat,
          diff,
          staged,
          recentMessages,
        }
      } catch {
        // Completion is opportunistic UI assistance; repository read failures
        // must not affect the Source Control panel or commit operation.
        return null
      }
    },

    getStashes: (userId, sessionId, repoRoot) =>
      readOr<RepoStash[]>(userId, sessionId, repoRoot, [], (b, cwd) => b.listStashes(cwd)),

    // Writes — each returns the refreshed status envelope (see `mutate`).
    revertHunk: (userId, sessionId, input, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.revertHunk(cwd, input)),

    stageLines: (userId, sessionId, input, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.stageLines(cwd, input)),

    unstageLines: (userId, sessionId, input, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.unstageLines(cwd, input)),

    discardLines: (userId, sessionId, input, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.discardLines(cwd, input)),

    revertCommit: (userId, sessionId, hash, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.revertCommit(cwd, hash), {
        branches: true,
      }),

    cherryPick: (userId, sessionId, hash, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.cherryPick(cwd, hash), { branches: true }),

    resetToCommit: (userId, sessionId, hash, mode, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.resetToCommit(cwd, hash, mode), {
        branches: true,
      }),

    checkoutCommit: (userId, sessionId, hash, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.checkoutCommit(cwd, hash), {
        branches: true,
      }),

    createBranchAt: (userId, sessionId, name, hash, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.createBranchAt(cwd, name, hash), {
        branches: true,
      }),

    switchBranch: (userId, sessionId, branch, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.switchBranch(cwd, branch), {
        branches: true,
      }),

    checkoutRemoteBranch: (userId, sessionId, remoteRef, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.checkoutRemoteBranch(cwd, remoteRef), {
        branches: true,
      }),

    mergeBranch: (userId, sessionId, branch, noFastForward, repoRoot) =>
      mutate(
        userId,
        sessionId,
        repoRoot,
        (b, cwd) => b.mergeBranch(cwd, branch, { noFastForward }),
        {
          branches: true,
        },
      ),

    abortMerge: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.abortMerge(cwd), { branches: true }),

    createBranch: (userId, sessionId, name, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.createBranch(cwd, name), {
        branches: true,
      }),

    renameBranch: (userId, sessionId, from, to, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.renameBranch(cwd, from, to), {
        branches: true,
      }),

    deleteBranch: (userId, sessionId, name, force, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.deleteBranch(cwd, name, force), {
        branches: true,
      }),

    stage: (userId, sessionId, paths, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.stage(cwd, paths)),

    unstage: (userId, sessionId, paths, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.unstage(cwd, paths)),

    discard: (userId, sessionId, paths, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.discard(cwd, paths)),

    addToGitignore: (userId, sessionId, patterns, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.addToGitignore(cwd, patterns)),

    commit: (userId, sessionId, message, repoRoot) =>
      mutate(
        userId,
        sessionId,
        repoRoot,
        async (b, cwd) => {
          await b.commit(cwd, message)
          await annotateHead(b, cwd, userId, sessionId, message)
        },
        { branches: true },
      ),

    amend: (userId, sessionId, message, repoRoot) =>
      mutate(
        userId,
        sessionId,
        repoRoot,
        async (b, cwd) => {
          await b.amend(cwd, message)
          // Amend rewrites HEAD to a new sha; re-annotate it with fresh provenance.
          await annotateHead(b, cwd, userId, sessionId, message)
        },
        { branches: true },
      ),

    nuke: (userId, sessionId, removeUntracked, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.nukeWorkingTree(cwd, { removeUntracked }), {
        branches: true,
      }),

    interactiveRebase: (userId, sessionId, fromHash, entries, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.interactiveRebase(cwd, fromHash, entries), {
        branches: true,
      }),

    rewordCommit: (userId, sessionId, hash, message, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.rewordCommit(cwd, hash, message), {
        branches: true,
      }),

    fixupInto: (userId, sessionId, hash, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.fixupInto(cwd, hash), { branches: true }),

    rebaseOnto: (userId, sessionId, base, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.rebaseOnto(cwd, base), { branches: true }),

    rebaseContinue: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.rebaseContinue(cwd), { branches: true }),

    rebaseAbort: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.rebaseAbort(cwd), { branches: true }),

    rebaseSkip: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.rebaseSkip(cwd), { branches: true }),

    bisectStart: (userId, sessionId, bad, good, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.bisectStart(cwd, bad, good), {
        branches: true,
      }),

    bisectMark: (userId, sessionId, term, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.bisectMark(cwd, term), { branches: true }),

    bisectReset: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.bisectReset(cwd), { branches: true }),

    push: (userId, sessionId, repoRoot, force) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.push(cwd, { force }), { branches: true }),

    pull: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.pull(cwd), { branches: true }),

    fetch: (userId, sessionId, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.fetch(cwd), { branches: true }),

    createStash: (userId, sessionId, input, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.createStash(cwd, input), {
        branches: true,
        stashes: true,
      }),

    applyStash: (userId, sessionId, index, pop, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.applyStash(cwd, index, pop), {
        branches: true,
        stashes: true,
      }),

    dropStash: (userId, sessionId, index, repoRoot) =>
      mutate(userId, sessionId, repoRoot, (b, cwd) => b.dropStash(cwd, index), {
        branches: true,
        stashes: true,
      }),
  }
}
