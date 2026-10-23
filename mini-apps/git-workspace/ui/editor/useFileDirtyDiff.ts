import { useCallback, useEffect, useState } from 'react'
import { isAtOrUnder } from '@localixai/path-containment/ancestry'
import type { RepoDiffLine, SourceControlStatus } from '../../backend/source-control/contracts'
import { sourceControlApi } from '../api'
import { useSourceControlStore } from '../source-control/model/store'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui'
import {
  computeWordDiffMarks,
  mergeDirtyChanges,
  parseUnifiedDiff,
  type DirtyChange,
  type DirtyDiffFeed,
  type EditorHunk,
} from '@localixai/kit/code-editor'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

/**
 * Quick-diff feed (gutter change ranges + word-level marks) for the open file,
 * driving the editor's staged/unstaged gutter. Anchored to the file on
 * disk: it refetches whenever the git poller reports this path's change stats or
 * staging split moved (an agent run finished, a save landed, a stage/discard
 * happened) and clears when the file is clean.
 *
 * Reads the shared source-control store (this file's `fileChangeStamp`) rather than polling git
 * itself — same cross-feature read the composer context bar already does — so it
 * costs a diff fetch only when the file is actually changed.
 *
 * Staged (index vs HEAD) and unstaged (worktree vs index) diffs are fetched
 * separately and MERGED into per-line stage tags: a line only in the staged diff
 * → FILLED bar, only in the unstaged diff → HOLLOW bar, in both → `both`. An
 * untracked file has no index entry, so its whole synthesized diff is unstaged.
 */

/** Re-serialize a backend line-diff into the minimal unified text `parseUnifiedDiff` reads. */
function linesToUnified(lines: RepoDiffLine[]): string {
  return lines
    .map((l) =>
      l.kind === 'hunk'
        ? l.content
        : `${l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ' '}${l.content}`,
    )
    .join('\n')
}

// The host's gutter reads `layer` — two visual weights it names `primary` and `secondary`, with no
// opinion about what fills them. Git's staged/unstaged split is that opinion, and it is applied
// here: the index is the primary layer, the working tree the secondary one.
const inLayer = (changes: DirtyChange[], layer: DirtyChange['layer']): DirtyChange[] =>
  changes.map((change) => ({ ...change, layer }))

/** The gutter's read side (the change feed) plus its write side (revert one hunk). */
export interface FileDirtyDiff {
  feed: DirtyDiffFeed | undefined
  /** Resolve the change hunk under a clicked gutter marker. Null on an untracked file
   *  (no committed base to revert to) or when the line is not inside a hunk. */
  hunkSource: (line: number) => Promise<EditorHunk | null>
  revertHunk: (hunk: EditorHunk) => Promise<void>
  /** After a revert: the file was rewritten ON DISK server-side, so the open buffer must
   *  reload and git must re-poll — which is what re-anchors this very gutter. */
  onHunkReverted: () => void
}

/**
 * `status:insertions:deletions:<staged><unstaged>` for the file at absolute `editPath`, or '' when
 * it is clean or outside the repo. Git paths are root-relative; ancestry goes through the owner
 * (server paths are POSIX), which closes the sibling-prefix trap: `/a/rootExtra/x` is NOT under
 * `/a/root` and must fall through to the absolute path, not be mis-sliced.
 */
export function fileChangeStamp(
  status: SourceControlStatus | null,
  editPath: string | null,
): string {
  if (!editPath || !status?.isRepo || !status.root) return ''
  const root = status.root.replace(/\/$/, '')
  const rel =
    editPath === root
      ? ''
      : isAtOrUnder(root, editPath)
        ? editPath.slice(root.length + 1)
        : editPath
  const entry = status.files.find((f) => f.path === rel)
  return entry
    ? `${entry.status}:${entry.insertions}:${entry.deletions}:${entry.staged ? 1 : 0}${entry.unstaged ? 1 : 0}`
    : ''
}

export function useFileDirtyDiff(sessionId: string | null, editPath: string | null): FileDirtyDiff {
  const workItemVisible = useWorkItemVisible()
  // This file's change fingerprint, selected as a PRIMITIVE: the editor re-renders only when THIS
  // file's entry moves, not whenever any other file in the repo changed (the whole-slice read made
  // every open editor re-render on every poll that touched the status).
  const stamp = useSourceControlStore((s) =>
    fileChangeStamp(sessionId ? (s.bySession[sessionId]?.status ?? null) : null, editPath),
  )

  // Fetch identity: the path + the change fingerprint (status + line counts + staging split), so
  // an unrelated status re-poll doesn't refetch, but a real content change, a stage/unstage, or a
  // switch to another file does.
  const key = sessionId && editPath && stamp ? `${sessionId} ${editPath} ${stamp}` : ''
  const untracked = stamp.startsWith('untracked:')

  // Keyed result so a stale feed from a previous file is never shown while the
  // current file's fetch is still in flight. setState runs only in async
  // callbacks (never synchronously in the effect body).
  const [result, setResult] = useState<{ key: string; feed: DirtyDiffFeed | undefined }>()

  useEffect(() => {
    if (!workItemVisible || !sessionId || !editPath || !key) return
    let cancelled = false

    const build = async (): Promise<DirtyDiffFeed | undefined> => {
      // Untracked: no index entry — the whole file is a new, unstaged addition.
      if (untracked) {
        const { diff, binary } = await sourceControlApi.getFileDiff(sessionId, editPath, {
          untracked: true,
        })
        if (binary || !diff) return undefined
        return {
          changes: inLayer(parseUnifiedDiff(diff), 'secondary'),
          wordMarks: computeWordDiffMarks(diff),
        }
      }
      const [staged, unstaged] = await Promise.all([
        sourceControlApi.getFileDiffLines(sessionId, editPath, 'staged'),
        sourceControlApi.getFileDiffLines(sessionId, editPath, 'unstaged'),
      ])
      if (staged.binary || unstaged.binary) return undefined
      const stagedText = linesToUnified(staged.lines)
      const unstagedText = linesToUnified(unstaged.lines)
      // Staged is the PRIMARY layer (the filled bar), unstaged the secondary one — the mapping
      // from git's two diffs onto the editor's two weights lives here, not in the editor.
      const changes = mergeDirtyChanges(
        parseUnifiedDiff(stagedText),
        parseUnifiedDiff(unstagedText),
      )
      if (changes.length === 0) return undefined
      // Word marks are the union of both sides' changed spans (the editor only
      // needs which character runs changed, not from which side).
      const wordMarks = [...computeWordDiffMarks(stagedText), ...computeWordDiffMarks(unstagedText)]
      return { changes, wordMarks }
    }

    void build()
      .then((feed) => {
        if (!cancelled) setResult({ key, feed })
      })
      .catch(() => {
        if (!cancelled) setResult({ key, feed: undefined })
      })
    return () => {
      cancelled = true
    }
  }, [workItemVisible, sessionId, editPath, key, untracked])

  const hunkSource = useCallback(
    async (line: number): Promise<EditorHunk | null> => {
      if (!sessionId || !editPath) return null
      const hunks = await sourceControlApi.getFileHunks(sessionId, editPath).catch(() => [])
      return hunks.find((h) => line >= h.modifiedStart && line <= h.modifiedEnd) ?? null
    },
    [sessionId, editPath],
  )

  const revertHunk = useCallback(
    async (hunk: EditorHunk) => {
      if (!sessionId || !editPath) return
      await sourceControlApi.revertHunk(sessionId, editPath, hunk.index, hunk.header)
    },
    [sessionId, editPath],
  )

  const onHunkReverted = useCallback(() => {
    if (editPath) miniAppFiles.announceReloaded([editPath])
    // No success row: the reverted lines vanish from the editor the person is looking at.
    if (sessionId) void useSourceControlStore.getState().refresh(sessionId)
  }, [sessionId, editPath])

  return {
    feed: key && result?.key === key ? result.feed : undefined,
    hunkSource,
    revertHunk,
    onHunkReverted,
  }
}
