import { type Dispatch, type SetStateAction, useCallback } from 'react'
import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { openFileInGrid } from '@/shared/lib/recentFiles'
import { basenameOf, canMoveInto, distinctParents, dirname } from './fileTreePaths'
import type { VisibleRow } from './fileTreePaths'
import type { FileTreeGuards } from './useDirectoryLoader'
import type { TreeClipboard } from './useFileTree'

/* oxlint-disable react-hooks/exhaustive-deps -- refs/setters are stable; preserve the pre-split dependency lists exactly */

/**
 * MOVING entries around the tree: the cut/copy clipboard, paste, and drag-and-drop.
 *
 * Separate from `useTreeSelection` because it owns a different thing. Selection answers
 * "which rows is the user pointing at" and lives entirely in local state; a transfer is a
 * WRITE against the workspace, and every one of them shares the same three rules that
 * selection has no opinion about:
 *
 *   - mutations stay SEQUENTIAL, so the server allocates collision-safe names in order,
 *   - directory reconciliation is BATCHED once per affected folder afterwards, and
 *   - a failure is an EVENT (a toast naming the entry), never the tree's `error` state —
 *     the sidebar renders that state INSTEAD of the tree, so one denied move would hide
 *     every file. That defect is documented at the delete path in `useTreeSelection`.
 *
 * `pastePath` is the single write; clipboard paste and drag-drop are two callers that
 * differ only in where the sources come from and how the clipboard is settled after.
 */
type UseTreeTransfersOptions = {
  sessionId: string | null
  selected: Map<string, 'file' | 'dir'>
  clipboard: TreeClipboard | null
  guards: FileTreeGuards
  ownsSession: () => boolean
  reloadDir: (path: string) => Promise<boolean>
  toastUndo: (message: string) => void
  setClipboard: Dispatch<SetStateAction<TreeClipboard | null>>
  setExpanded: Dispatch<SetStateAction<Set<string>>>
}

export function useTreeTransfers({
  sessionId,
  selected,
  clipboard,
  guards,
  ownsSession,
  reloadDir,
  toastUndo,
  setClipboard,
  setExpanded,
}: UseTreeTransfersOptions) {
  const { clipboardRef } = guards

  // Mark entries for a later paste. When `row` is part of a multi-selection the
  // whole selection is clipped (distinctParents drops any child nested under a
  // clipped folder); otherwise just this row. Cut = move-on-paste (dimmed until
  // pasted); copy = duplicate-on-paste (kept, so you can paste into several folders).
  const clip = useCallback(
    (row: VisibleRow, mode: 'cut' | 'copy') => {
      const inBatch = selected.has(row.path) && selected.size > 1
      const paths = inBatch ? distinctParents([...selected.keys()]) : [row.path]
      const next = { paths, mode }
      clipboardRef.current = next
      setClipboard(next)
    },
    [selected],
  )

  // Paste `sourcePath` into `destDir` (move or copy). Shared by clipboard paste
  // and drag-and-drop; callers reconcile the affected directories once after
  // their whole batch. Returns the pasted entry (its new path/type) or null on
  // no-op/failure. A same-dir move is a no-op the caller can ignore.
  const pastePath = useCallback(
    async (sourcePath: string, destDir: string, mode: 'move' | 'copy') => {
      if (!sessionId || !ownsSession()) return null
      if (mode === 'move' && dirname(sourcePath) === destDir) return null // same-dir move = no-op
      try {
        const res = await backendClient.pasteFileEntry(sessionId, sourcePath, destDir, mode)
        if (!ownsSession()) return null
        setExpanded((s) => (s.has(destDir) ? s : new Set(s).add(destDir)))
        if (mode === 'move') {
          // Follow the moved file into the editor so the open tab points at its new path.
          if (res.type === 'file') openFileInGrid({ sessionId, path: res.path })
          toastUndo(`Moved “${basenameOf(res.path)}”`)
        }
        return res
      } catch (e) {
        if (ownsSession())
          toast.error(
            mode === 'move'
              ? `Could not move “${basenameOf(sourcePath)}” into “${basenameOf(destDir)}”`
              : `Could not copy “${basenameOf(sourcePath)}” into “${basenameOf(destDir)}”`,
            { description: errorMessage(e, '') || undefined },
          )
        return null
      }
    },
    [sessionId, ownsSession, toastUndo],
  )

  // Paste every clipboard entry into `destDir`. A cut moves (then clears the
  // clipboard once anything moved); a copy duplicates (auto-incrementing the name
  // server-side on collision) and stays on the clipboard for re-paste. Entries are
  // pasted sequentially so their folder reloads don't race.
  const pasteInto = useCallback(
    async (destDir: string) => {
      if (!clipboard || !ownsSession()) return
      const sourceClipboard = clipboard
      const mode = clipboard.mode === 'cut' ? 'move' : 'copy'
      let moved = false
      const affectedDirs = new Set<string>()
      for (const src of clipboard.paths) {
        // Keep writes sequential so the server allocates collision-safe names in
        // order, then reconcile each shared directory once after the whole batch.
        // oxlint-disable-next-line react-doctor/async-await-in-loop -- collision-safe names depend on the preceding mutation
        const res = await pastePath(src, destDir, mode)
        if (res) {
          moved = true
          affectedDirs.add(destDir)
          if (mode === 'move') affectedDirs.add(dirname(src))
        }
        if (!ownsSession()) return
      }
      await Promise.all([...affectedDirs].map((dir) => reloadDir(dir)))
      if (!ownsSession()) return
      if (sourceClipboard.mode === 'cut' && moved && clipboardRef.current === sourceClipboard) {
        clipboardRef.current = null
        setClipboard(null)
      }
    },
    [clipboard, ownsSession, pastePath, reloadDir],
  )

  // Drag-and-drop one or more tree entries onto a folder: default = move, Alt/Opt
  // = copy. Illegal targets (same-parent/self/descendant)
  // are skipped; the server enforces the same guards. Mutations stay sequential
  // for collision-safe names, while directory reconciliation is batched.
  const dropEntries = useCallback(
    async (sources: readonly string[], destDir: string, copy: boolean) => {
      const affectedDirs = new Set<string>()
      for (const src of sources) {
        if (!ownsSession()) return
        if (canMoveInto(src, destDir)) {
          // oxlint-disable-next-line react-doctor/async-await-in-loop -- collision-safe names depend on the preceding mutation
          const res = await pastePath(src, destDir, copy ? 'copy' : 'move')
          if (res) {
            affectedDirs.add(destDir)
            if (!copy) affectedDirs.add(dirname(src))
          }
        }
      }
      await Promise.all([...affectedDirs].map((dir) => reloadDir(dir)))
    },
    [ownsSession, pastePath, reloadDir],
  )

  return { clip, pasteInto, dropEntries }
}
