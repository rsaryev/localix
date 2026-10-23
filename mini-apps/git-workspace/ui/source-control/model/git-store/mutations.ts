/**
 * Every write the store exposes, as ONE table: how to call it, and whether it
 * moves a ref the commit graph draws.
 *
 * The defect this shape prevents: the store used to spell ~40 near-identical
 * methods by hand, each `applyMutation(...)` followed — or not — by its own
 * `logVersion` bump. Commit, amend, pull, switch, checkout, cherry-pick, revert
 * and create-branch all forgot the bump, so the commit graph kept showing the
 * old tip after the very commit the user had just made. With the bump a
 * required field of each row, a write cannot be added without deciding it, and
 * `mutations.test.ts` checks the decision against what each API group says it
 * invalidates.
 *
 * `bumpsLog` is true for everything that moves HEAD or any ref the graph
 * decorates (branches, remote-tracking refs): the whole history family and the
 * ref family except the stash stack, which is not on the graph. Working-tree
 * writes (staging, discarding, `.gitignore`) never move a ref.
 */
import type {
  BisectTerm,
  RebaseTodoEntry,
  ResetMode,
  SourceControlMutation,
} from '../../../../backend/source-control/contracts'
import type { sourceControlApi } from '../../../api'

export type SourceControlApi = typeof sourceControlApi

/** What every write is issued against: the session, and the repo currently focused in it. */
export interface MutationContext {
  sessionId: string
  /** The focused repo (multi-root); undefined → the session's primary repo. */
  repo: string | undefined
}

export interface MutationSpec<A extends unknown[]> {
  bumpsLog: boolean
  run: (api: SourceControlApi, ctx: MutationContext, ...args: A) => Promise<SourceControlMutation>
}

type Run<A extends unknown[]> = MutationSpec<A>['run']
/** A write confined to the working tree and index. */
const tree = <A extends unknown[]>(run: Run<A>): MutationSpec<A> => ({ bumpsLog: false, run })
/** A write that moves HEAD or a ref the commit graph decorates. */
const refs = <A extends unknown[]>(run: Run<A>): MutationSpec<A> => ({ bumpsLog: true, run })

export const MUTATIONS = {
  // --- Working tree / index (optional `repoRoot` overrides the focus) ------------
  /** Stage paths (files or dirs). */
  stage: tree((api, c, paths: string[], repoRoot?: string) =>
    api.stage(c.sessionId, paths, repoRoot ?? c.repo),
  ),
  unstage: tree((api, c, paths: string[], repoRoot?: string) =>
    api.unstage(c.sessionId, paths, repoRoot ?? c.repo),
  ),
  /** Discard all changes under paths (destructive). */
  discard: tree((api, c, paths: string[], repoRoot?: string) =>
    api.discard(c.sessionId, paths, repoRoot ?? c.repo),
  ),
  /** Append repo-root-anchored patterns to the repo's `.gitignore`. */
  addToGitignore: tree((api, c, patterns: string[], repoRoot?: string) =>
    api.addToGitignore(c.sessionId, patterns, repoRoot ?? c.repo),
  ),
  /** Stage exactly the selected diff lines of a file (a partial stage). */
  stageLines: tree((api, c, path: string, lines: number[], diffId: string, repoRoot?: string) =>
    api.stageLines(c.sessionId, path, lines, diffId, repoRoot ?? c.repo),
  ),
  unstageLines: tree((api, c, path: string, lines: number[], diffId: string, repoRoot?: string) =>
    api.unstageLines(c.sessionId, path, lines, diffId, repoRoot ?? c.repo),
  ),
  /** Discard exactly the selected diff lines from the working tree (destructive). */
  discardLines: tree((api, c, path: string, lines: number[], diffId: string, repoRoot?: string) =>
    api.discardLines(c.sessionId, path, lines, diffId, repoRoot ?? c.repo),
  ),

  // --- Stash stack (not drawn on the graph) --------------------------------------
  /** Save the working tree to a new stash; throws when there is nothing to stash. */
  createStash: tree((api, c, opts?: { message?: string; includeUntracked?: boolean }) =>
    api.createStash(c.sessionId, opts, c.repo),
  ),
  /** Restore a stash by index (`pop` removes it); throws on conflict/missing. */
  applyStash: tree((api, c, index: number, pop: boolean) =>
    api.applyStash(c.sessionId, index, pop, c.repo),
  ),
  dropStash: tree((api, c, index: number) => api.dropStash(c.sessionId, index, c.repo)),

  // --- Refs and remotes ---------------------------------------------------------
  /** Checkout `branch`; throws on failure (e.g. dirty tree) so callers can toast. */
  switchBranch: refs((api, c, branch: string) => api.switchBranch(c.sessionId, branch, c.repo)),
  /** Create a branch off HEAD and switch to it; throws on a bad/duplicate name. */
  createBranch: refs((api, c, name: string) => api.createBranch(c.sessionId, name, c.repo)),
  renameBranch: refs((api, c, from: string, to: string) =>
    api.renameBranch(c.sessionId, from, to, c.repo),
  ),
  /** Delete a local branch (`force` uses `-D`); throws for current/occupied/unmerged. */
  deleteBranch: refs((api, c, name: string, force: boolean) =>
    api.deleteBranch(c.sessionId, name, force, c.repo),
  ),
  /** Check out `origin/x` by creating its local tracking branch. */
  checkoutRemoteBranch: refs((api, c, remoteRef: string) =>
    api.checkoutRemoteBranch(c.sessionId, remoteRef, c.repo),
  ),
  /** Create branch `name` at `hash` without switching. */
  createBranchAt: refs((api, c, name: string, hash: string) =>
    api.createBranchAt(c.sessionId, name, hash, c.repo),
  ),
  /** Merge `branch` into the current one; throws `git_merge_conflict` when it stops. */
  mergeBranch: refs((api, c, branch: string, noFastForward?: boolean) =>
    api.mergeBranch(c.sessionId, branch, noFastForward, c.repo),
  ),
  abortMerge: refs((api, c) => api.abortMerge(c.sessionId, c.repo)),
  /** Push the current branch; `force` retries with `--force-with-lease` after a rejection. */
  push: refs((api, c, force?: boolean) => api.push(c.sessionId, c.repo, force)),
  /** Fast-forward to the upstream; throws on divergence. */
  pull: refs((api, c) => api.pull(c.sessionId, c.repo)),
  /** Refresh remote-tracking refs (the graph's `origin/*` chips move). */
  fetch: refs((api, c) => api.fetch(c.sessionId, c.repo)),

  // --- History ------------------------------------------------------------------
  /** Commit the staged changes; throws on failure (e.g. nothing staged). */
  commit: refs((api, c, message: string, repoRoot?: string) =>
    api.commit(c.sessionId, message, repoRoot ?? c.repo),
  ),
  /** Rewrite the last commit, folding in staged changes. */
  amend: refs((api, c, message: string, repoRoot?: string) =>
    api.amend(c.sessionId, message, repoRoot ?? c.repo),
  ),
  /** Discard ALL uncommitted changes (optionally untracked too); destructive. */
  nuke: refs((api, c, removeUntracked: boolean) => api.nuke(c.sessionId, removeUntracked, c.repo)),
  revertCommit: refs((api, c, hash: string) => api.revertCommit(c.sessionId, hash, c.repo)),
  cherryPick: refs((api, c, hash: string) => api.cherryPick(c.sessionId, hash, c.repo)),
  resetToCommit: refs((api, c, hash: string, mode: ResetMode) =>
    api.resetToCommit(c.sessionId, hash, mode, c.repo),
  ),
  /** Check out `hash` (detached HEAD). */
  checkoutCommit: refs((api, c, hash: string) => api.checkoutCommit(c.sessionId, hash, c.repo)),
  interactiveRebase: refs((api, c, fromHash: string, entries: RebaseTodoEntry[]) =>
    api.interactiveRebase(c.sessionId, fromHash, entries, c.repo),
  ),
  rewordCommit: refs((api, c, hash: string, message: string) =>
    api.rewordCommit(c.sessionId, hash, message, c.repo),
  ),
  /** Fold the staged changes into an older commit. */
  fixupInto: refs((api, c, hash: string) => api.fixupInto(c.sessionId, hash, c.repo)),
  rebaseOnto: refs((api, c, base: string) => api.rebaseOnto(c.sessionId, base, c.repo)),
  rebaseContinue: refs((api, c) => api.rebaseContinue(c.sessionId, c.repo)),
  rebaseAbort: refs((api, c) => api.rebaseAbort(c.sessionId, c.repo)),
  rebaseSkip: refs((api, c) => api.rebaseSkip(c.sessionId, c.repo)),
  /** Start a bisect marking `hash` bad (+ optional good); checks out the midpoint. */
  bisectStart: refs((api, c, hash: string, good?: string) =>
    api.bisectStart(c.sessionId, hash, good, c.repo),
  ),
  bisectMark: refs((api, c, term: BisectTerm) => api.bisectMark(c.sessionId, term, c.repo)),
  bisectReset: refs((api, c) => api.bisectReset(c.sessionId, c.repo)),
}

type ArgsOf<S> = S extends MutationSpec<infer A> ? A : never

/** The store methods the table produces: `(sessionId, ...args) => Promise<void>`, throwing on failure. */
export type MutationMethods = {
  [K in keyof typeof MUTATIONS]: (
    sessionId: string,
    ...args: ArgsOf<(typeof MUTATIONS)[K]>
  ) => Promise<void>
}
