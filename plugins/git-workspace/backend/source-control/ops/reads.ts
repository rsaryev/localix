/**
 * Everything that only OBSERVES the repository. The status, branch, workspace
 * and log reads answer for a NON-repo too (an empty envelope, not a 404); diffs
 * require a real repo; decoration reads degrade to a neutral value.
 */
import { GIT_PREREQUISITE } from '../git-prerequisite'
import type { BlameLine, CommitNote, RepoStash, RepoWithStatus } from '../contracts'
import type { SourceControlReads } from '../service-contract'
import type { ResolveCwd } from '../ports'
import { emptyBranches, emptyStatus, type RepoAccess } from './repo-access'

export interface SourceControlReadDeps {
  resolveCwd: ResolveCwd
  /** Optional: enumerate the session's repos with status (multi-root view). */
  listRepoStatuses?: (userId: string, sessionId: string | null) => Promise<RepoWithStatus[]>
  /** Is `git` on this machine — "no repository" may mean it is not. */
  gitInstalled: () => boolean
}

export function createSourceControlReads(
  access: RepoAccess,
  deps: SourceControlReadDeps,
): SourceControlReads {
  const { backendFor, resolve, withEnvelope, readBranches, read, readOr } = access
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
        return deps.gitInstalled()
          ? emptyStatus()
          : { ...emptyStatus(), prerequisite: GIT_PREREQUISITE }
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
  }
}
