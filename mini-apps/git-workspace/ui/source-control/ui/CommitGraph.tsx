import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { acknowledgeInline } from '@localixai/mini-app-sdk/ui'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { ConfirmDialog } from '@localixai/kit/confirm-dialog'
import { Button } from '@localixai/kit/button'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { RepoCommit } from '../../../backend/source-control/contracts'
import { sourceControlApi } from '../../api'
import { useHeadStamp, useSessionGitField, useSourceControlStore } from '../model/store'
import { assignCommitLanes } from '../model/commitLanes'
import { gitDetail, gitReadProblem } from '../model/gitFailure'
import { useCommitFilter } from '../model/useCommitFilter'
import { useCommitGraphOps } from '../model/useCommitGraphOps'
import { useReadWhenStale } from '../model/useReadWhenStale'
import { useStableHandler } from '../model/useStableHandler'
import { InteractiveRebaseDialog } from './InteractiveRebaseDialog'
import { CommitFilterBar } from './CommitFilterBar'
import { BranchAtDialog, RewordDialog } from './CommitGraphDialogs'
import { CommitRow, type CommitAction } from './CommitRow'

/** How many commits the graph reads. */
const LOG_LIMIT = 40

/**
 * Recent commits on the current branch as a compact timeline (dot + connecting rail). It only
 * mounts when its CollapsibleSection is open, and it re-reads the log only when what the log
 * depends on moved — the repo, the filter, or the HEAD stamp (which carries the store's
 * `logVersion`) — never on a mere re-show of the tab.
 *
 * Power features ride the list: a debounced filter bar (`git log
 * --grep/--author/-- <path>`), and "Mark for compare" → "Compare with marked" for a range diff.
 * Right-click opens commit-level git operations; `reset --hard` confirms first, "New branch
 * here…" and "Reword…" prompt. A failed read says why instead of claiming there are no commits.
 */
export function CommitGraph({
  sessionId,
  onSelectCommit,
  onCompare,
}: {
  sessionId: string
  /** Click/keyboard-select a commit to open its full diff. */
  onSelectCommit?: (hash: string) => void
  /** Compare two commits: `from` (marked base) → `to`. Opens a range diff. */
  onCompare?: (from: string, to: string) => void
}) {
  const workItemVisible = useWorkItemVisible()
  const gitStatus = useSessionGitField(sessionId, 'status')
  const branch = gitStatus?.branch ?? null
  // The commit log follows the active repo (multi-root); its root scopes every read.
  const activeRepo = gitStatus?.root ?? undefined
  const bisect = gitStatus?.bisect ?? null
  const stamp = useHeadStamp(sessionId)
  const filter = useCommitFilter()

  const [commits, setCommits] = useState<RepoCommit[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The commit marked as a compare base (local — resets when CommitsPane remounts the graph).
  const [marked, setMarked] = useState<RepoCommit | null>(null)
  const [pendingHardReset, setPendingHardReset] = useState<RepoCommit | null>(null)
  const [branchAt, setBranchAt] = useState<RepoCommit | null>(null)
  const [rewordTarget, setRewordTarget] = useState<RepoCommit | null>(null)
  const [rebaseFromIndex, setRebaseFromIndex] = useState<number | null>(null)

  // `done` marks the read fresh only once its answer landed; the cleanup cancels a stale
  // in-flight read so an older filter can't overwrite a newer result. A failed read keeps the
  // list it had and says why.
  const load = useCallback(
    (done?: () => void) => {
      let cancelled = false
      sourceControlApi
        .getLog(sessionId, LOG_LIMIT, filter.active, activeRepo)
        .then((c) => {
          if (cancelled) return
          setCommits(c)
          setLoadError(null)
          done?.()
        })
        .catch((err: unknown) => {
          if (cancelled) return
          setCommits((prev) => prev ?? [])
          acknowledgeInline(err)
          setLoadError(
            gitReadProblem(gitDetail(err) ?? '', 'Could not read the commit log').message,
          )
        })
      return () => {
        cancelled = true
      }
    },
    [sessionId, filter.active, activeRepo],
  )
  const readKey = `${activeRepo ?? ''}\u0000${JSON.stringify(filter.active)}\u0000${stamp}`
  useReadWhenStale(workItemVisible, readKey, load)
  const reload = useCallback(() => void load(), [load])

  const ops = useCommitGraphOps(sessionId, branch, reload)
  const store = useSourceControlStore.getState()

  const dispatch = useStableHandler((action: CommitAction, c: RepoCommit, i: number) => {
    switch (action.kind) {
      case 'select':
        return onSelectCommit?.(c.hash)
      case 'mark':
        return setMarked(c)
      case 'clearMark':
        return setMarked(null)
      case 'compare':
        return marked && onCompare?.(marked.hash, c.hash)
      case 'checkout':
        return ops.doCheckout(c)
      case 'branchHere':
        return setBranchAt(c)
      case 'revert':
        return ops.doRevert(c)
      case 'cherryPick':
        return ops.doCherryPick(c)
      case 'rebaseFrom':
        return setRebaseFromIndex(i)
      case 'reword':
        return setRewordTarget(c)
      case 'fixup':
        return ops.doFixup(c)
      case 'rebaseOnto':
        return ops.doRebaseOnto(c)
      case 'bisectStart':
        return ops.doBisectStart(c)
      case 'bisectMark':
        return ops.doBisectMark(c, action.term)
      case 'reset':
        return action.mode === 'hard' ? setPendingHardReset(c) : ops.doReset(c, action.mode)
    }
  })

  // Lane/rail layout — only when unfiltered (under a filter the parents of shown commits fall
  // outside the set, so a rail would mislead). Recomputed only when the list or filter changes.
  const { laneRows, railWidth } = useMemo(() => {
    if (!commits || commits.length === 0 || filter.hasFilter) {
      return { laneRows: null, railWidth: 1 }
    }
    const rows = assignCommitLanes(commits)
    return { laneRows: rows, railWidth: Math.max(1, ...rows.map((r) => r.width)) }
  }, [commits, filter.hasFilter])

  // Commits from the right-clicked one up to HEAD (newest first) — the rebase range.
  const rebaseRange =
    commits && rebaseFromIndex !== null ? commits.slice(0, rebaseFromIndex + 1) : []

  const errorHint = loadError && (
    <EmptyHint className="justify-start px-3 py-2 text-2xs">{loadError}</EmptyHint>
  )
  // The kit's two list states, placed like `BranchesSection`'s.
  let body: ReactNode
  if (commits === null) {
    body = <LoadingHint className="justify-start px-3 py-2 text-2xs">Loading commits…</LoadingHint>
  } else if (commits.length === 0) {
    body =
      errorHint ??
      (filter.hasFilter ? (
        <div className="flex flex-col items-start gap-1 px-3 py-2">
          <EmptyHint className="justify-start p-0 text-2xs">
            No commits match this filter.
          </EmptyHint>
          <Button size="xs" variant="link" className="h-auto px-0" onClick={filter.clear}>
            Clear filter
          </Button>
        </div>
      ) : (
        <EmptyHint className="justify-start px-3 py-2 text-2xs">No commits yet.</EmptyHint>
      ))
  } else {
    body = (
      <>
        {errorHint}
        {commits.map((c, i) => (
          <CommitRow
            key={c.hash}
            commit={c}
            index={i}
            laneRow={laneRows?.[i]}
            railWidth={railWidth}
            isLast={i === commits.length - 1}
            isBase={marked?.hash === c.hash}
            markedShortHash={marked?.shortHash ?? null}
            canCompare={Boolean(onCompare)}
            busy={ops.busy}
            bisecting={Boolean(bisect?.bisecting)}
            bisectHere={c.hash === bisect?.current?.hash}
            dispatch={dispatch}
          />
        ))}
      </>
    )
  }

  return (
    <div className="pb-1">
      <CommitFilterBar filter={filter} />
      {body}

      <ConfirmDialog
        open={pendingHardReset !== null}
        variant="destructive"
        title="Reset — hard?"
        description={
          pendingHardReset
            ? `Move the current branch to ${pendingHardReset.shortHash} and DISCARD every commit after it plus all uncommitted changes in the working tree. This cannot be undone.`
            : ''
        }
        confirmLabel="Reset hard"
        onConfirm={() => {
          const target = pendingHardReset
          setPendingHardReset(null)
          if (target) ops.doReset(target, 'hard')
        }}
        onClose={() => setPendingHardReset(null)}
      />

      <BranchAtDialog
        target={branchAt}
        onClose={() => setBranchAt(null)}
        onSubmit={(name, target) => {
          setBranchAt(null)
          void ops.run(
            () => store.createBranchAt(sessionId, name, target.hash),
            `Could not create ${name}`,
          )
        }}
      />

      <RewordDialog
        target={rewordTarget}
        onClose={() => setRewordTarget(null)}
        onSubmit={(message, target) => {
          setRewordTarget(null)
          void ops.run(
            () => store.rewordCommit(sessionId, target.hash, message),
            `Could not reword ${target.shortHash}`,
          )
        }}
      />

      {rebaseFromIndex !== null && rebaseRange.length > 0 && (
        <InteractiveRebaseDialog
          open
          fromHash={rebaseRange[rebaseRange.length - 1]!.hash}
          commitsNewestFirst={rebaseRange}
          branch={branch}
          onApply={ops.applyRebase}
          onClose={() => setRebaseFromIndex(null)}
        />
      )}
    </div>
  )
}
