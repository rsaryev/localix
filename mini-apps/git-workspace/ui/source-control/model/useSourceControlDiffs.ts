import { useCallback, useState } from 'react'
import { toast } from '@localixai/mini-app-sdk/ui'
import type { FileDiff, RepoFileChange } from '../../../backend/source-control/contracts'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui'
import { openChangedFile, toAbsPath } from './openChangedFile'
import { sourceControlApi } from '../../api'
import { gitFailed } from './gitFailure'

/**
 * The selected Changes row. A repo-relative path alone is not an identity in a
 * multi-root view — `package.json` exists in every repository, and a path-only key
 * lit the row up in all of them.
 */
export function selectionKey(root: string | undefined, path: string): string {
  return `${root ?? ''}\0${path}`
}

interface MultiFileOpen {
  /** The chat whose repository this is — the diff opens in that chat's grid. */
  sessionId: string
  load: () => Promise<Pick<FileDiff, 'diff' | 'truncated'>>
  path: string
  title: string
  root: string | undefined
  empty: string
  failure: string
  provenance?: () => Promise<unknown>
}

/**
 * Open a whole-change diff (commit, compare, stash, PR, working tree) in the host's
 * multi-file viewer. One path for all five, because each used to restate it and they
 * drifted: all of them refused a change whose files were ALL binary with a toast,
 * while the viewer lists binary files perfectly well; only the working-tree opener
 * knew an empty diff can be a race with the poll.
 */
async function openMultiFile(spec: MultiFileOpen): Promise<void> {
  try {
    const d = await spec.load()
    if (!d.diff.trim()) {
      // Kept as a row: nothing opens, so this is the only answer the click gets.
      toast.info(spec.empty)
      return
    }
    const provenance = spec.provenance ? await spec.provenance().catch(() => null) : null
    miniAppWorkspace.openDiff({
      sessionId: spec.sessionId,
      path: spec.path,
      diff: d.diff,
      title: spec.title,
      ephemeral: true,
      multiFile: true,
      rootPath: spec.root,
      truncated: d.truncated,
      provenance: provenance ?? undefined,
    })
  } catch (err) {
    gitFailed(spec.failure, err)
  }
}

/**
 * The Source Control panel's inspector-diff openers: a changed file's diff (an
 * interactive line-staging surface for tracked files, read-only otherwise), and the
 * whole-change diffs above. Owns the selected-row highlight so a click both opens
 * the diff and marks the row.
 *
 * `rootPath` is the active repo's root (git paths are repo-root-relative); the
 * per-file openers accept an override for the multi-root grouped view.
 */
export function useSourceControlDiffs(sessionId: string | null, rootPath: string | undefined) {
  const [selected, setSelected] = useState<string | null>(null)

  const openDiff = async (file: RepoFileChange, staged: boolean, repoRoot?: string) => {
    if (!sessionId) return
    const root = repoRoot ?? rootPath
    setSelected(selectionKey(root, file.path))
    await openChangedFile(sessionId, file, staged, root)
  }

  const openWorkingDiff = async (repoRoot?: string) => {
    if (!sessionId) return
    const root = repoRoot ?? rootPath
    return openMultiFile({
      sessionId,
      load: () => sourceControlApi.getWorkingDiff(sessionId, root),
      path: root ? `working:${root}` : 'working-tree',
      title: 'Working tree changes',
      root,
      // The button is offered only while the tree has changes: empty means it went clean
      // between the poll and the click.
      empty: 'The working tree is clean',
      failure: 'Could not load the working-tree diff',
    })
  }

  const openCommitDiff = useCallback(
    async (hash: string) => {
      if (!sessionId) return
      return openMultiFile({
        sessionId,
        load: () => sourceControlApi.getCommitDiff(sessionId, hash, rootPath),
        path: hash,
        title: `Commit ${hash.slice(0, 7)}`,
        root: rootPath,
        empty: 'This commit has no changes',
        failure: 'Could not load the commit diff',
        // The localix provenance note, when the commit went through our commit path.
        provenance: () => sourceControlApi.getCommitNote(sessionId, hash, rootPath),
      })
    },
    [sessionId, rootPath],
  )

  const openRangeDiff = async (from: string, to: string) => {
    if (!sessionId) return
    return openMultiFile({
      sessionId,
      load: () => sourceControlApi.getRangeDiff(sessionId, from, to, false, rootPath),
      path: `${from}..${to}`,
      title: `Compare ${from.slice(0, 7)} → ${to.slice(0, 7)}`,
      root: rootPath,
      empty: 'These two commits are identical',
      failure: 'Could not compare the commits',
    })
  }

  const openStashDiff = async (stash: { index: number; message: string }) => {
    if (!sessionId) return
    return openMultiFile({
      sessionId,
      load: () => sourceControlApi.getStashDiff(sessionId, stash.index, rootPath),
      path: `stash@{${stash.index}}`,
      title: `Stash: ${stash.message}`,
      root: rootPath,
      empty: 'This stash has no changes',
      failure: 'Could not load the stash diff',
    })
  }

  // In a multi-root project the PR section is scoped to the active repo, which may differ
  // from this hook's `rootPath` — the caller's override resolves the right repo.
  const openPrDiff = async (pr: { number: number; title: string }, repoRoot?: string) => {
    if (!sessionId) return
    const root = repoRoot ?? rootPath
    return openMultiFile({
      sessionId,
      load: () => sourceControlApi.getPrDiff(sessionId, pr.number, root),
      path: `pr-${pr.number}`,
      title: `PR #${pr.number}: ${pr.title}`,
      root,
      empty: 'This pull request has no changes',
      failure: 'Could not load the pull-request diff',
    })
  }

  // The inline "Open File" action, distinct from the row-click diff.
  const openFile = (file: RepoFileChange, repoRoot?: string) => {
    if (!sessionId) return
    miniAppWorkspace.openFile({ sessionId, path: toAbsPath(repoRoot ?? rootPath, file.path) })
  }

  /** The selected repo-relative path IF the selection belongs to this repo, else null. */
  const selectedPathIn = useCallback(
    (repoRoot?: string): string | null => {
      if (selected === null) return null
      const prefix = selectionKey(repoRoot ?? rootPath, '')
      return selected.startsWith(prefix) ? selected.slice(prefix.length) : null
    },
    [selected, rootPath],
  )

  return {
    selectedPathIn,
    openDiff,
    openWorkingDiff,
    openCommitDiff,
    openRangeDiff,
    openStashDiff,
    openPrDiff,
    openFile,
  }
}
