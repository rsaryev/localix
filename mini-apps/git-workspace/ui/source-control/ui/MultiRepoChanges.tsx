import { useMemo } from 'react'
import type { RepoFileChange, RepoWithStatus } from '../../../backend/source-control/contracts'
import type { ChangeActions } from '../model/changeActions'
import { guardGit } from '../model/gitFailure'
import { useSourceControlStore } from '../model/store'
import { useStableHandler } from '../model/useStableHandler'
import { RepoChangesGroup, type RepoGroupHandlers } from './RepoChangesGroup'

/**
 * ONE handler object for every repo group, stable for the session.
 *
 * Opening a file or the full diff also focuses its repo, so the header, commit box and log follow
 * what the person is looking at.
 */
export function useRepoGroupHandlers(
  sessionId: string | null,
  deps: {
    toggle: (repo: RepoWithStatus) => void
    openDiff: (file: RepoFileChange, staged: boolean, repoRoot: string) => unknown
    openWorkingDiff: (repoRoot: string) => unknown
  },
): RepoGroupHandlers {
  const toggle = useStableHandler(deps.toggle)
  const openDiff = useStableHandler(deps.openDiff)
  const openWorkingDiff = useStableHandler(deps.openWorkingDiff)
  return useMemo(() => {
    const store = useSourceControlStore.getState()
    const focus = (root: string) => {
      if (sessionId) void store.setActiveRepo(sessionId, root)
    }
    return {
      onToggle: toggle,
      onFocus: focus,
      onStageAll: (paths, root) =>
        sessionId && void guardGit('Could not stage', () => store.stage(sessionId, paths, root)),
      onUnstageAll: (paths, root) =>
        sessionId &&
        void guardGit('Could not unstage', () => store.unstage(sessionId, paths, root)),
      onOpen: (file, staged, root) => {
        focus(root)
        void openDiff(file, staged, root)
      },
      onOpenAllDiff: (root) => {
        focus(root)
        void openWorkingDiff(root)
      },
    }
  }, [sessionId, toggle, openDiff, openWorkingDiff])
}

/** The multi-root Changes layout: one focusable group per repository, its own trees inside. */
export function MultiRepoChanges({
  repos,
  activeRepo,
  isOpen,
  selectedPathIn,
  actionsFor,
  handlers,
}: {
  repos: RepoWithStatus[]
  activeRepo: string | null
  isOpen: (repo: RepoWithStatus) => boolean
  /** The selected repo-relative path, only when the selection belongs to that repo. */
  selectedPathIn: (repoRoot?: string) => string | null
  actionsFor: (repoRoot?: string) => ChangeActions | undefined
  handlers: RepoGroupHandlers
}) {
  return repos.map((repo) => {
    const actions = actionsFor(repo.root)
    if (!actions) return null
    return (
      <RepoChangesGroup
        key={repo.root}
        repo={repo}
        active={repo.root === activeRepo}
        open={isOpen(repo)}
        selectedPath={selectedPathIn(repo.root)}
        actions={actions}
        handlers={handlers}
      />
    )
  })
}
