import { useMemo } from 'react'
import { FileQuestion } from 'lucide-react'
import { StateNotice } from '@localixai/kit/state-notice'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { toast } from '@localixai/mini-app-sdk/ui'
import type { RepoFileChange, RepoStash } from '../../../backend/source-control/contracts'
import { useSessionGit, useSourceControlStore } from '../model/store'
import { repoPresence } from '../model/repoPresence'
import { useCommitsPane } from '../model/useCommitsPane'
import { useRepoCollapse } from '../model/useRepoCollapse'
import { useSourceControlDiffs } from '../model/useSourceControlDiffs'
import { useGitPanelOps } from '../model/useGitPanelOps'
import { useChangeActions } from '../model/changeActions'
import { useChangeGroups } from '../model/changeGroups'
import { commitCompletionKey } from '../model/commitCompletionKey'
import { guardGit } from '../model/gitFailure'
import { useGitProblems } from '../model/useGitProblems'
import { ProblemLine, ProblemState } from '@localixai/mini-app-sdk/ui/components'
import { useStableHandler } from '../model/useStableHandler'
import { usePullRequests } from '../model/usePullRequests'
import { sourceControlApi } from '../../api'
import { ChangesScrollArea } from './changes-tree/ChangesScrollArea'
import { SingleRepoChanges } from './SingleRepoChanges'
import { MultiRepoChanges, useRepoGroupHandlers } from './MultiRepoChanges'
import { MultiRepoBar } from './MultiRepoBar'
import { CommitBox } from './CommitBox'
import { CommitsPane } from './CommitsPane'
import { SourceControlHeader } from './SourceControlHeader'
import { BranchesSection } from './BranchesSection'
import { StashesSection } from './StashesSection'
import { PullRequestsSection } from './PullRequestsSection'
import { useSourceControlConfirms } from './SourceControlDialogs'

/**
 * Source Control panel: a layout orchestrator. The Changes area (flat or grouped by repo) scrolls
 * as one region above the commit log and the pinned commit composer; the three destructive
 * confirmations, the diff openers, the remote/recovery ops and the change actions each live in
 * their own module. Handlers that reach the memoized trees are stable, so an unchanged poll
 * re-renders none of their rows.
 */
export function SourceControlTab({ sessionId }: { sessionId: string | null }) {
  const { status, stashes, repos, activeRepo, loading, error } = useSessionGit(sessionId)
  // Multi-root: more than one git repo under the container dir → group the Changes by repo.
  const multiRoot = repos.length > 1
  // Scope every repo-backed op even when discovery found exactly one nested repository: layout
  // grouping is presentation and must not decide what commit completion/history target.
  const scopedRepoRoot = activeRepo ?? undefined
  // Actions only — event handlers, never render; zustand action identities are stable.
  const store = useSourceControlStore.getState()
  const diffs = useSourceControlDiffs(sessionId, status?.root ?? undefined)
  const ops = useGitPanelOps(sessionId, scopedRepoRoot)
  const confirms = useSourceControlConfirms(sessionId, ops.nuke)
  const actionsFor = useChangeActions(sessionId, {
    openFile: diffs.openFile,
    requestDiscard: confirms.requestDiscard,
  })
  const pane = useCommitsPane()
  const pullRequests = usePullRequests(sessionId, scopedRepoRoot, status?.branch ?? null)
  const gitProblems = useGitProblems({ sessionId, status, error })
  const collapse = useRepoCollapse(repos)
  const groupHandlers = useRepoGroupHandlers(sessionId, {
    toggle: collapse.toggle,
    openDiff: diffs.openDiff,
    openWorkingDiff: diffs.openWorkingDiff,
  })

  const files = useMemo(() => status?.files ?? [], [status])
  const groups = useChangeGroups(files)
  const contextKey = useMemo(
    () => commitCompletionKey(scopedRepoRoot, status),
    [scopedRepoRoot, status],
  )
  const dirtyRepoCount = useMemo(
    () => repos.filter((r) => r.status.files.length > 0).length,
    [repos],
  )

  const onOpen = useStableHandler((file: RepoFileChange, staged: boolean) => {
    void diffs.openDiff(file, staged)
  })
  const onStageAll = useStableHandler((paths: string[]) => {
    if (sessionId) void guardGit('Could not stage', () => store.stage(sessionId, paths))
  })
  const onUnstageAll = useStableHandler((paths: string[]) => {
    if (sessionId) void guardGit('Could not unstage', () => store.unstage(sessionId, paths))
  })

  const createPr = async () => {
    if (!sessionId) return
    // No success row: the browser opening IS the result.
    const opened = await guardGit('Could not open the pull-request page', () =>
      sourceControlApi.createPullRequest(sessionId, scopedRepoRoot),
    )
    // The new PR may exist now — refresh shortly after the browser round-trip.
    if (opened) setTimeout(() => pullRequests.reload(), 1500)
  }

  // Commit-all / amend-all: with nothing explicitly staged, stage every change first. Pinned to
  // the repo whose composer submitted, so a focus change mid-flight cannot make it jump repos.
  // No success rows: the committed files leave the list and the composer clears. A conflict is a
  // precondition the person can fix right here, not a failure — a transient answer, never a
  // journal row. HEAD's message re-reads itself off the log bump.
  const writeHead = async (kind: 'commit' | 'amend', message: string): Promise<boolean> => {
    if (!sessionId) return false
    if (groups.conflicts.length > 0) {
      toast.info(
        `Resolve every merge conflict before ${kind === 'commit' ? 'committing' : 'amending'}`,
      )
      return false
    }
    const targetRepo = scopedRepoRoot
    if (groups.staged.length === 0 && files.length > 0) {
      const paths = files.map((f) => f.path)
      const staged = await guardGit('Could not stage the changes', () =>
        store.stage(sessionId, paths, targetRepo),
      )
      if (!staged) return false
    }
    return kind === 'commit'
      ? guardGit('Could not commit', () => store.commit(sessionId, message, targetRepo))
      : guardGit('Could not amend the last commit', () =>
          store.amend(sessionId, message, targetRepo),
        )
  }

  // No success rows: the stash's changes appear in the Changes list (and a pop removes its row).
  const stashActions = {
    onPop: (index: number) =>
      sessionId &&
      void guardGit('Could not pop the stash', () => store.applyStash(sessionId, index, true)),
    onApply: (index: number) =>
      sessionId &&
      void guardGit('Could not apply the stash', () => store.applyStash(sessionId, index, false)),
    onDrop: (stash: RepoStash) => confirms.requestStashDrop(stash),
    onView: (stash: RepoStash) => void diffs.openStashDiff(stash),
  }

  const singleActions = actionsFor()
  if (!sessionId || !singleActions) {
    return <EmptyHint>Open a chat session to view source control.</EmptyHint>
  }
  // Not "not a repo" while the host has not resolved the session's directory yet.
  if (status?.unresolved) return <LoadingHint>Reading the working directory…</LoadingHint>
  // No git on this machine is not "not a repository" — say which, and offer to install it.
  if (gitProblems.missing) return <ProblemState {...gitProblems.missing} />
  if (repoPresence(status) === 'not-repo') {
    return (
      <StateNotice
        icon={FileQuestion}
        title="Not a git repository"
        body="This session's working directory isn't version-controlled."
      />
    )
  }
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <SourceControlHeader
        status={status}
        loading={loading}
        pushing={ops.pushing}
        pulling={ops.pulling}
        fetching={ops.fetching}
        canStash={files.length > 0}
        stashing={ops.stashing}
        canNuke={files.length > 0}
        nuking={ops.nuking}
        onOpenAllDiff={multiRoot ? undefined : () => void diffs.openWorkingDiff()}
        rebaseBusy={ops.rebaseBusy}
        onRebaseContinue={() =>
          void ops.rebaseStep(
            () => store.rebaseContinue(sessionId),
            'Could not continue the rebase',
          )
        }
        onRebaseAbort={() =>
          void ops.rebaseStep(() => store.rebaseAbort(sessionId), 'Could not abort the rebase')
        }
        onRebaseSkip={() =>
          void ops.rebaseStep(() => store.rebaseSkip(sessionId), 'Could not skip this patch')
        }
        bisectBusy={ops.bisectBusy}
        onBisectGood={() =>
          void ops.bisectStep(
            () => store.bisectMark(sessionId, 'good'),
            'Could not mark this commit good',
          )
        }
        onBisectBad={() =>
          void ops.bisectStep(
            () => store.bisectMark(sessionId, 'bad'),
            'Could not mark this commit bad',
          )
        }
        onBisectSkip={() =>
          void ops.bisectStep(
            () => store.bisectMark(sessionId, 'skip'),
            'Could not skip this commit in the bisect',
          )
        }
        onBisectReset={() =>
          void ops.bisectStep(() => store.bisectReset(sessionId), 'Could not end the bisect')
        }
        onPush={() => void ops.push()}
        onPull={() => void ops.pull()}
        onFetch={() => void ops.fetch()}
        onStash={() => void ops.stashAll()}
        onNuke={confirms.requestNuke}
        onRefresh={() => void store.refresh(sessionId)}
      />

      {gitProblems.read && <ProblemLine {...gitProblems.read} className="shrink-0 px-3 py-1.5" />}

      {multiRoot && (
        <MultiRepoBar
          repoCount={repos.length}
          dirtyCount={dirtyRepoCount}
          activeName={repos.find((r) => r.root === activeRepo)?.name ?? '—'}
          canExpand={collapse.anyClosed}
          canCollapse={collapse.anyOpen}
          onExpandAll={collapse.expandAll}
          onCollapseAll={collapse.collapseAll}
        />
      )}

      {/* Changes pane — scrolls independently of the commit log below, and is the viewport the
          Changes trees virtualize against. Vertical-only: long paths / repo + branch names
          truncate instead of sprouting a horizontal scrollbar. */}
      <ChangesScrollArea className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">
        {multiRoot ? (
          <MultiRepoChanges
            repos={repos}
            activeRepo={activeRepo}
            isOpen={collapse.isOpen}
            selectedPathIn={diffs.selectedPathIn}
            actionsFor={actionsFor}
            handlers={groupHandlers}
          />
        ) : (
          <SingleRepoChanges
            groups={groups}
            empty={files.length === 0}
            selectedPath={diffs.selectedPathIn()}
            actions={singleActions}
            onOpen={onOpen}
            onStageAll={onStageAll}
            onUnstageAll={onUnstageAll}
          />
        )}

        {/* Below the working-tree changes: PRs, branches, stashes. */}
        <PullRequestsSection
          status={pullRequests.status}
          prs={pullRequests.prs}
          error={pullRequests.error}
          currentBranch={status?.branch ?? null}
          refreshing={pullRequests.refreshing}
          onReload={pullRequests.reload}
          onCreatePr={() => void createPr()}
          onOpenDiff={(pr) => diffs.openPrDiff(pr, scopedRepoRoot)}
        />
        <BranchesSection sessionId={sessionId} />
        <StashesSection stashes={stashes} actions={stashActions} />
      </ChangesScrollArea>

      {/* Commit-log pane — its own scroll; a draggable divider sets its height. */}
      <CommitsPane
        sessionId={sessionId}
        repoRoot={scopedRepoRoot}
        commitsOpen={pane.commitsOpen}
        setCommitsOpen={pane.setCommitsOpen}
        resize={pane.resize}
        onSelectCommit={(hash) => void diffs.openCommitDiff(hash)}
        onCompare={(from, to) => void diffs.openRangeDiff(from, to)}
      />

      {/* Commit composer — pinned to the BOTTOM of the panel (chat-composer position): the changes
          tree and the commit log scroll above it, right where the eye lands after the diff. */}
      {files.length > 0 && (
        <CommitBox
          key={`${sessionId}\u0000${scopedRepoRoot ?? ''}`}
          sessionId={sessionId}
          repoRoot={scopedRepoRoot}
          contextKey={contextKey}
          stagedCount={groups.staged.length}
          headMessage={ops.headMessage}
          recentMessages={ops.recentMessages}
          refreshContext={() => store.refreshFresh(sessionId)}
          onCommit={(message) => writeHead('commit', message)}
          onAmend={(message) => writeHead('amend', message)}
        />
      )}

      {confirms.dialogs}
    </div>
  )
}
