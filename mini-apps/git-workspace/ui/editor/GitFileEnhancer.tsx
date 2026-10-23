import { useCallback } from 'react'
import type { FileEditorEnhancerProps } from '@localixai/mini-app-sdk/ui'
import type { InlineBlameLine, InlineBlameSource } from '@localixai/kit/code-editor'

import { sourceControlApi } from '../api'
import { useFileDirtyDiff } from './useFileDirtyDiff'
import { isAtOrUnder } from '@localixai/path-containment/ancestry'
import { useSessionRepoRoots } from '../source-control/model/store'
import { useSourceControlDiffs } from '../source-control/model/useSourceControlDiffs'

export function GitFileEnhancer({ sessionId, path, render }: FileEditorEnhancerProps) {
  const dirtyDiff = useFileDirtyDiff(sessionId ?? null, path)
  // Roots only, compared by value: this runs for every open editor, and reading the whole slice
  // re-rendered each of them on every poll that changed any file's status.
  const repoRoots = useSessionRepoRoots(sessionId)
  const rootPath = repoRoots
    .filter((root) => isAtOrUnder(root, path))
    .sort((a, b) => b.length - a.length)[0]
  const { openCommitDiff } = useSourceControlDiffs(sessionId ?? null, rootPath)
  const blameSource: InlineBlameSource = useCallback(
    async (signal: AbortSignal): Promise<InlineBlameLine[] | null> => {
      if (!sessionId || !path) return null
      try {
        const lines = await sourceControlApi.getBlame(sessionId, path, rootPath)
        return signal.aborted
          ? null
          : lines.map((line) => ({
              ...line,
              onSelect: line.uncommitted ? undefined : () => void openCommitDiff(line.sha),
            }))
      } catch {
        return null
      }
    },
    [sessionId, path, rootPath, openCommitDiff],
  )
  return render({ dirtyDiff, blameSource })
}
