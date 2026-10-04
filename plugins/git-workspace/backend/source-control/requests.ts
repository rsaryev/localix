/**
 * HTTP request schemas for `/rpc/source-control` — the TRANSPORT half of this
 * feature's contract. The domain model it validates into lives in `contracts.ts`
 * and knows nothing about HTTP; these schemas change when a ROUTE changes (a new
 * query param, a coercion, a body field), which is a different reason than the
 * model changing. `routes.ts` is their only consumer.
 *
 * Every request is SCOPED — see {@link scoped}.
 */
import { z } from 'zod'

import { bisectTermSchema, rebaseActionSchema, resetModeSchema } from './contracts'
import { isSafeRef } from './git/ref'

/** Query-string booleans arrive as text; a body may send a real boolean. */
const flag = z.enum(['0', '1', 'true', 'false']).optional()

/**
 * A hash, branch or ref that is passed to git as an argument. Checked here, at the boundary,
 * because a value like `--hard` would otherwise be read by git as an option (see `git/ref.ts`).
 */
const ref = z
  .string()
  .min(1)
  .refine(isSafeRef, 'Not a git ref (empty, whitespace or a leading "-").')

/**
 * The scope EVERY source-control request carries: the session whose cwd resolves
 * the repository, and — in a multi-root project (a container dir holding several
 * repos) — which repo under it to act on. Omitting `repoRoot` targets the
 * session's primary repo, so a single-repo client never mentions it.
 *
 * This pair used to be re-typed in all ~30 schemas below; it has one definition.
 */
const scoped = z.object({
  sessionId: z.string().optional(),
  /** Target repo root for multi-root projects; omitted → the session's primary repo. */
  repoRoot: z.string().optional(),
})

/** Nothing beyond the scope — status, branches, log-less reads. */
export const sessionQuerySchema = scoped

// --- Reads: diffs, hunks, blame ------------------------------------------------

/** Fetch a forge pull request's unified diff by number. */
export const prDiffQuerySchema = scoped.extend({
  /** The pull-request number (coerced from the query string). */
  number: z.coerce.number().int().positive(),
})

export const fileDiffQuerySchema = scoped.extend({
  path: z.string().min(1),
  staged: flag,
  untracked: flag,
})

/** Per-line authorship of a file (optionally a 1-based line range), for inline blame. */
export const blameQuerySchema = scoped.extend({
  path: z.string().min(1),
  /** Optional 1-based start line (`-L start,end`); requires `endLine`. */
  startLine: z.coerce.number().int().min(1).optional(),
  /** Optional 1-based end line (inclusive). */
  endLine: z.coerce.number().int().min(1).optional(),
})

/** All granular change hunks of a file vs HEAD (for the inline peek + revert). */
export const fileHunksQuerySchema = scoped.extend({
  path: z.string().min(1),
})

/** Revert a single hunk of a file back to its committed state. */
export const revertHunkSchema = scoped.extend({
  path: z.string().min(1),
  /** 0-based hunk index in the file's ordered `-U0` hunk list. */
  index: z.coerce.number().int().min(0),
  /** The hunk's `@@` header — matched server-side to guard against drift. */
  header: z.string().min(1),
})

/** A file's diff as selectable lines, for the line-staging view. */
export const diffLinesQuerySchema = scoped.extend({
  path: z.string().min(1),
  /** `staged` → index vs HEAD; `unstaged` (default) → worktree vs index. */
  mode: z.enum(['staged', 'unstaged']).optional(),
})

/** Stage / unstage / discard a set of diff lines of one file. */
export const lineStageSchema = scoped.extend({
  path: z.string().min(1),
  /** Raw-diff line indices to include (from `FileDiffLines.lines[].index`). */
  lines: z.array(z.coerce.number().int().min(0)).min(1),
  /** Fingerprint of the diff the selection was made against — server-checked for drift. */
  diffId: z.string().min(1),
})

// --- Branches ------------------------------------------------------------------

export const switchBranchSchema = scoped.extend({
  branch: ref,
})

/** Check out a remote-tracking ref (`origin/x`) by creating its local tracking branch. */
export const checkoutRemoteSchema = scoped.extend({
  remoteRef: ref,
})

/** Merge a branch into the current one. `noFastForward` always records a merge commit. */
export const mergeBranchSchema = scoped.extend({
  branch: ref,
  noFastForward: z.boolean().optional(),
})

/** Push the current branch; `force` uses `--force-with-lease`. */
export const pushSchema = scoped.extend({
  force: z.boolean().optional(),
})

/** Create a new branch off HEAD and switch to it. git validates the name. */
export const createBranchSchema = scoped.extend({
  name: ref,
})

/** Rename branch `from` to `to`. git validates `to` (and rejects an existing name). */
export const renameBranchSchema = scoped.extend({
  from: ref,
  to: ref,
})

/** Delete a local branch. `force` (`-D`) drops an unmerged branch; git refuses the current/occupied one. */
export const deleteBranchSchema = scoped.extend({
  name: ref,
  force: z.boolean().optional(),
})

// --- History -------------------------------------------------------------------

export const logQuerySchema = scoped.extend({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  /** Filter by commit message text (`git log --grep`). */
  query: z.string().optional(),
  /** Filter by author name/email (`git log --author`). */
  author: z.string().optional(),
  /** Filter to commits touching this repo-relative path (`git log -- <path>`). */
  path: z.string().optional(),
})

/** Diff between two commits (`from` base, `to` target). */
export const rangeDiffQuerySchema = scoped.extend({
  from: ref,
  to: ref,
  /** Symmetric three-dot diff (`from...to`) instead of the default two-dot. */
  threeDot: flag,
})

/** Full patch of a single commit by hash/ref. */
export const commitDiffQuerySchema = scoped.extend({
  hash: ref,
})

/** Provenance note of a single commit by hash/ref. */
export const commitNoteQuerySchema = scoped.extend({
  hash: ref,
})

// --- Working tree: stage, commit, stash ----------------------------------------

/** Stage / unstage / discard a set of paths (files or directories). */
export const pathsSchema = scoped.extend({
  paths: z.array(z.string().min(1)).min(1),
})

export const gitignoreSchema = scoped.extend({
  /** Repo-root-anchored gitignore lines to append (e.g. `/dist`, `/src/foo.ts`, `/logs/`). */
  patterns: z.array(z.string().min(1)).min(1),
})

export const commitSchema = scoped.extend({
  message: z.string().min(1),
})

/** Rewrite the last commit, folding in staged changes (shares the commit shape). */
export const amendSchema = commitSchema

/** Save the working tree to a new stash. Optional label; untracked files included by default. */
export const stashPushSchema = scoped.extend({
  message: z.string().optional(),
  /** Include untracked files in the stash (git `-u`). Defaults to true. */
  includeUntracked: z.boolean().optional(),
})

/** Apply/pop/drop a stash by its stack index. */
export const stashRefSchema = scoped.extend({
  /** 0-based stash index (0 = most recent). */
  index: z.coerce.number().int().min(0),
})

// --- Commit-level operations (by hash) ----------------------------------------

/** Operate on a single commit identified by hash/ref (revert / cherry-pick / checkout). */
export const commitRefSchema = scoped.extend({
  hash: ref,
})

/** Move the current branch to a commit at the given `mode`. */
export const resetCommitSchema = scoped.extend({
  hash: ref,
  mode: resetModeSchema,
})

/** Create a new branch pointing at a specific commit (without switching to it). */
export const branchAtSchema = scoped.extend({
  name: ref,
  hash: ref,
})

// --- Recovery / danger operations ---------------------------------------------

/**
 * Nuke the working tree — discard ALL uncommitted changes. `removeUntracked`
 * also deletes untracked files (`git clean -fd`, ignored dirs preserved);
 * defaults to false (tracked changes only).
 */
export const nukeSchema = scoped.extend({
  removeUntracked: z.boolean().optional(),
})

// --- Interactive rebase (history rewrite) -------------------------------------

/** One row of a composed rebase todo — the wire shape of `RebaseTodoEntry`. */
export const rebaseTodoEntrySchema = z.object({
  hash: ref,
  action: rebaseActionSchema,
  message: z.string().optional(),
})

/**
 * Apply a composed interactive rebase. `fromHash` is the OLDEST commit to
 * include (the rebase replays onto its parent, or `--root` when it has none);
 * `entries` are the commits `fromHash..HEAD` in APPLY order (oldest first) with
 * their actions, exactly as the todo editor arranged them.
 */
export const interactiveRebaseSchema = scoped.extend({
  fromHash: ref,
  entries: z.array(rebaseTodoEntrySchema).min(1),
})

/** Change an existing commit's message (a one-commit reword rebase, or amend when it's HEAD). */
export const rewordSchema = scoped.extend({
  hash: ref,
  message: z.string().min(1),
})

/** Fold the currently-staged changes into an older commit (`--fixup` + autosquash). */
export const fixupIntoSchema = scoped.extend({
  hash: ref,
})

/** Rebase the current branch onto `base` (a commit sha or branch name). */
export const rebaseOntoSchema = scoped.extend({
  base: ref,
})

// --- Bisect (regression search) -----------------------------------------------

/** Start a bisect: mark `bad` (regression present) and optionally `good` (works). */
export const bisectStartSchema = scoped.extend({
  hash: ref,
  /** Optional known-good commit; when omitted the user marks a good commit later. */
  good: ref.optional(),
})

/** Mark the current commit `good`/`bad`/`skip` and advance the search. */
export const bisectMarkSchema = scoped.extend({
  term: bisectTermSchema,
})
