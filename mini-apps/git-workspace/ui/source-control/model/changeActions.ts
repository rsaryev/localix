import { useMemo } from 'react'
import type { RepoFileChange } from '../../../backend/source-control/contracts'
import { guardGit } from './gitFailure'
import { useSourceControlStore } from './store'
import { useStableHandler } from './useStableHandler'

/** Stage / unstage / discard handlers — files pass `[path]`, folders pass their dir path (git accepts dir pathspecs). */
export interface ChangeActions {
  onStage: (paths: string[]) => void
  onUnstage: (paths: string[]) => void
  onDiscard: (paths: string[], label: string) => void
  /** Open the actual file in the editor (the inline "Open File" action). Not offered for deleted files. */
  onOpenFile?: (file: RepoFileChange) => void
  /** Right-click "Add to .gitignore" — appends the repo-root-anchored pattern(s). */
  onAddToGitignore?: (patterns: string[]) => void
}

/** A discard waiting for confirmation (destructive), pinned to the repo it was asked in. */
export interface DiscardRequest {
  paths: string[]
  label: string
  repoRoot?: string
}

export interface ChangeActionDeps {
  openFile: (file: RepoFileChange, repoRoot?: string) => void
  requestDiscard: (request: DiscardRequest) => void
}

/** The actions of one repo's Changes trees. `repoRoot` undefined → the focused repo. */
export function makeChangeActions(
  sessionId: string,
  repoRoot: string | undefined,
  deps: ChangeActionDeps,
): ChangeActions {
  const store = useSourceControlStore.getState()
  return {
    onStage: (paths) =>
      void guardGit('Could not stage', () => store.stage(sessionId, paths, repoRoot)),
    onUnstage: (paths) =>
      void guardGit('Could not unstage', () => store.unstage(sessionId, paths, repoRoot)),
    onDiscard: (paths, label) => deps.requestDiscard({ paths, label, repoRoot }),
    onOpenFile: (file) => deps.openFile(file, repoRoot),
    onAddToGitignore: (patterns) =>
      void guardGit('Could not update .gitignore', () =>
        store.addToGitignore(sessionId, patterns, repoRoot),
      ),
  }
}

/**
 * `actionsFor(repoRoot)` — ONE `ChangeActions` object per repo for the life of the session.
 *
 * The panel used to rebuild the actions (and, in the multi-root view, one set per repo) on every
 * render, so every memoized Changes-tree row saw a new `actions` prop on each poll and re-rendered.
 * The deps are routed through stable handlers, so a cached object never calls a stale opener.
 */
export function useChangeActions(
  sessionId: string | null,
  deps: ChangeActionDeps,
): (repoRoot?: string) => ChangeActions | undefined {
  const openFile = useStableHandler(deps.openFile)
  const requestDiscard = useStableHandler(deps.requestDiscard)
  return useMemo(
    () => cachedChangeActions(sessionId, { openFile, requestDiscard }),
    [sessionId, openFile, requestDiscard],
  )
}

/** The per-repo cache behind `useChangeActions`, built once per session and handler set. */
function cachedChangeActions(
  sessionId: string | null,
  deps: ChangeActionDeps,
): (repoRoot?: string) => ChangeActions | undefined {
  const cache = new Map<string, ChangeActions>()
  return (repoRoot) => {
    if (!sessionId) return undefined
    const key = repoRoot ?? ''
    let actions = cache.get(key)
    if (!actions) {
      actions = makeChangeActions(sessionId, repoRoot, deps)
      cache.set(key, actions)
    }
    return actions
  }
}
