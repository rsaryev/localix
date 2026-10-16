import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react'
import { backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { openFileInGrid } from '../model/fileNav'
import { basenameOf, distinctParents, dirname, type VisibleRow } from './fileTreePaths'
import type { FileTreeGuards } from './useDirectoryLoader'
import type { PendingDelete, SelectMods } from './useFileTree'

/* oxlint-disable react-hooks/exhaustive-deps -- refs/setters are stable; preserve the pre-split dependency lists exactly */

/**
 * WHICH ROWS the user is pointing at, and the two operations driven by that answer.
 *
 * Selection is local state (a path→kind map plus the range anchor). Delete and duplicate
 * live here rather than with the other writes in `useTreeTransfers` because they are
 * SELECTION-DRIVEN: acting on a row inside a multi-selection acts on the whole selection,
 * `distinctParents` collapses children of selected folders so nothing is touched twice,
 * and the deleted paths have to be dropped from the selection afterwards. The clipboard
 * and drag-and-drop writes have no such coupling and moved out.
 */
type Selection = Map<string, 'file' | 'dir'>

type UseTreeSelectionOptions = {
  sessionId: string | null
  pendingDelete: PendingDelete[] | null
  deletePermanent: boolean
  selected: Selection
  guards: FileTreeGuards
  anchorRef: RefObject<string | null>
  ownsSession: () => boolean
  reloadDir: (path: string) => Promise<boolean>
  /** Records a journaled change; with a message, also publishes its Undo row. */
  toastUndo: (message?: string) => void
  setPendingDelete: Dispatch<SetStateAction<PendingDelete[] | null>>
  setDeletePermanent: Dispatch<SetStateAction<boolean>>
  setSelected: Dispatch<SetStateAction<Selection>>
}

export function useTreeSelection({
  sessionId,
  pendingDelete,
  deletePermanent,
  selected,
  guards,
  anchorRef,
  ownsSession,
  reloadDir,
  toastUndo,
  setPendingDelete,
  setDeletePermanent,
  setSelected,
}: UseTreeSelectionOptions) {
  const { deleteInFlightRef } = guards

  // Update the multi-selection for a click/keypress on `row`. No modifier =
  // replace with just this row (and set it as the range anchor); toggle
  // (⌘/Ctrl) = add/remove one; range (Shift) = select the contiguous span from
  // the anchor to this row over the caller's authoritative visible order.
  // Clear the whole multi-selection — clicking empty tree space deselects.
  const clearSelection = useCallback(() => {
    setSelected((prev) => (prev.size ? new Map() : prev))
    anchorRef.current = null
  }, [])

  const selectRow = useCallback(
    (row: VisibleRow, mods: SelectMods, orderedRows: readonly VisibleRow[]) => {
      setSelected((prev) => {
        if (mods.range && anchorRef.current) {
          const ai = orderedRows.findIndex((candidate) => candidate.path === anchorRef.current)
          const ti = orderedRows.findIndex((candidate) => candidate.path === row.path)
          if (ai >= 0 && ti >= 0) {
            const [lo, hi] = ai < ti ? [ai, ti] : [ti, ai]
            const next = new Map(mods.toggle ? prev : undefined)
            for (let i = lo; i <= hi; i++) {
              const candidate = orderedRows[i]!
              next.set(candidate.path, candidate.type)
            }
            return next
          }
        }
        if (mods.toggle) {
          const next = new Map(prev)
          if (next.has(row.path)) next.delete(row.path)
          else next.set(row.path, row.type)
          anchorRef.current = row.path
          return next
        }
        anchorRef.current = row.path
        return new Map([[row.path, row.type]])
      })
    },
    [],
  )

  // Queue a delete confirmation. When `row` is part of a multi-selection, the
  // whole selection is deleted; `distinctParents` drops any selected child that
  // sits inside a selected folder so we never double-delete.
  const requestDelete = useCallback(
    (row: VisibleRow, permanent = false) => {
      const inBatch = selected.has(row.path) && selected.size > 1
      const paths = inBatch ? [...selected.keys()] : [row.path]
      setDeletePermanent(permanent)
      setPendingDelete(
        distinctParents(paths).map((p) => ({
          path: p,
          name: basenameOf(p),
          type: p === row.path ? row.type : (selected.get(p) ?? 'file'),
        })),
      )
    },
    [selected],
  )

  const confirmDelete = useCallback(async () => {
    if (!sessionId || !pendingDelete || !ownsSession() || deleteInFlightRef.current) return
    deleteInFlightRef.current = true
    const targets = pendingDelete
    const permanent = deletePermanent
    setPendingDelete(null)
    const parents = new Set<string>()
    let trashed = 0
    try {
      const results = await Promise.allSettled(
        targets.map(async (target) => ({
          target,
          response: await backendClient.deleteFileEntry(sessionId, target.path, { permanent }),
        })),
      )
      if (!ownsSession()) return
      const failures: { name: string; reason: string }[] = []
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { target, response } = result.value
          if (response.trashed === true) trashed += 1
          parents.add(dirname(target.path))
        } else {
          failures.push({
            name: targets[index]!.name,
            reason: errorMessage(result.reason, 'No reason given.'),
          })
        }
      })
      // A failed delete is an EVENT, not a standing condition. It used to go into the tree's
      // `error` state, which the sidebar renders INSTEAD of the tree — so one permission-denied
      // file hid every file. The headline counts the entries that actually FAILED (it used to
      // count the whole selection, so one refusal among ten read as ten), and the body keeps
      // every reason, not just the first.
      if (failures.length) {
        toast.error(
          targets.length === 1
            ? `Could not delete “${targets[0]!.name}”`
            : `Could not delete ${failures.length} of ${targets.length} entries`,
          {
            description:
              targets.length === 1
                ? failures[0]!.reason
                : failures.map((f) => `“${f.name}”: ${f.reason}`).join('\n'),
          },
        )
      }
      await Promise.all([...parents].map((d) => reloadDir(d)))
      if (!ownsSession()) return
      // A single move-to-trash is reversible — offer Undo. A batch journals one change per entry,
      // so each is recorded (keeping older rows' Undo honest) but offers no row of its own.
      if (targets.length === 1 && trashed === 1) toastUndo(`Moved “${targets[0]!.name}” to Trash`)
      else for (let i = 0; i < trashed; i += 1) toastUndo()
      // Drop the deleted paths from the selection.
      setSelected((prev) => {
        if (!prev.size) return prev
        const next = new Map(prev)
        for (const t of targets) next.delete(t.path)
        return next
      })
    } finally {
      deleteInFlightRef.current = false
    }
  }, [sessionId, pendingDelete, deletePermanent, ownsSession, reloadDir, toastUndo])

  // Duplicate a tree entry in place (server copies it into its own folder with an
  // auto-incremented name) and refresh that folder.
  const duplicate = useCallback(
    async (row: VisibleRow) => {
      if (!sessionId || !ownsSession()) return
      try {
        const res = await backendClient.duplicateFileEntry(sessionId, row.path)
        if (!ownsSession()) return
        await reloadDir(dirname(row.path))
        if (res.type === 'file' && ownsSession()) openFileInGrid({ sessionId, path: res.path })
      } catch (e) {
        if (ownsSession())
          toast.error(`Could not duplicate “${row.name}”`, {
            description: errorMessage(e, '') || undefined,
          })
      }
    },
    [sessionId, ownsSession, reloadDir],
  )

  return { clearSelection, selectRow, requestDelete, confirmDelete, duplicate }
}
