/**
 * WHERE A CONVERSATION'S PLAN LIVES ON DISK — pure path rules, no IO.
 *
 * The defect these paths exist to stop: a plan existed only as the `present` call's argument, so
 * every change, and every re-show of a version the person had set aside, meant retyping it whole.
 * One session ended with v4 being v2 re-typed verbatim, because nothing could bring v2 back. A
 * plan is now a FILE the agent writes and changes with its ordinary tools:
 *
 *   <session cwd>/.localix/plans/<ROOT-REF>/PLAN.md   the working draft — the agent's to edit;
 *   <same dir>/v<N>.md                                 version N as the person saw it — the host's.
 *
 * The session cwd is the run's `defaultCwd` (the project's working dir, else the conversation's
 * sandbox), shared by every session of the tree; the ref is the ROOT's, because the plan is the
 * root conversation's. The database row stays the source of truth for a version: a hand-edited
 * `v<N>.md` is re-written from it the next time the host touches that version.
 *
 * Pure on purpose: `isPlanFilePath` runs inside a tool's `classify`, on the permission path,
 * where nothing may be looked up.
 */
import path from 'node:path'

export const PLAN_DRAFT_FILE = 'PLAN.md'

/** The conversation's plan directory. Every reader and writer of a plan path goes through it. */
export function planDraftDir(cwd: string, rootRef: string): string {
  return path.join(cwd, '.localix', 'plans', rootRef)
}

export const planDraftPath = (dir: string): string => path.join(dir, PLAN_DRAFT_FILE)

export const planSnapshotPath = (dir: string, version: number): string =>
  path.join(dir, `v${version}.md`)

/**
 * Whether a RESOLVED write target has the plan directory's shape: a `*.md` file directly inside
 * `.localix/plans/<ref>/`. That shape is the conversation's own state, so plan mode lets the
 * agent write it. Anything else under `.localix` — settings, a nested file, a plan directory's
 * non-markdown file — is an ordinary file write and stays refused in plan mode.
 */
export function isPlanFilePath(target: string): boolean {
  const parts = path.normalize(target).split(/[\\/]+/u)
  if (parts.length < 4) return false
  const [dotDir, plans, ref, file] = parts.slice(-4)
  return (
    dotDir === '.localix' &&
    plans === 'plans' &&
    !!ref &&
    ref !== '.' &&
    ref !== '..' &&
    !!file &&
    /^[^.].*\.md$/iu.test(file)
  )
}

/**
 * Whether a RESOLVED write target is a plan file of ONE conversation — the one whose plan
 * directory is `ownDir`. The shape alone (`isPlanFilePath`) also matches another conversation's
 * `.localix/plans/<ref>/`, and a plan-mode run could then rewrite a plan that is not its own.
 */
export function isOwnPlanFile(target: string, ownDir: string): boolean {
  return isPlanFilePath(target) && path.dirname(path.normalize(target)) === path.normalize(ownDir)
}
