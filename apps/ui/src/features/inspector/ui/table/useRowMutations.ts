import { useRef, useState, type SetStateAction } from 'react'
import type { TableColumn, TableRow } from '@localixai/dataview'

/** A batch of row mutations handed to the consumer on Commit. */
export interface StagedChanges {
  updates: { row: TableRow; values: Record<string, string | null> }[]
  inserts: Record<string, string | null>[]
  deletes: TableRow[]
}

export interface RowMutationHandlers {
  /** Immediate-mode cell write. Ignored in staged mode. */
  onCellEdit?: (row: TableRow, columnId: string, next: string | null) => void
  /** Immediate-mode row insert. Ignored in staged mode. */
  onAddRow?: (values: Record<string, string | null>) => void
  /** Immediate-mode row delete. Ignored in staged mode. */
  onDeleteRow?: (row: TableRow) => void
  /** Presence of this callback SWITCHES the grid into staged mode: edits, inserts and
   *  deletes accumulate here and are applied as ONE batch on Commit. Resolving `false`
   *  keeps the staged state (e.g. the batch failed server-side). */
  onCommitChanges?: (changes: StagedChanges) => Promise<boolean>
}

interface PendingInsert {
  id: number
  values: Record<string, string | null>
}

/**
 * The grid's row-mutation ledger — everything that turns a gesture into a write.
 *
 * It owns ONE decision the rest of the grid never has to re-derive: whether a cell
 * edit / insert / delete fires IMMEDIATELY at the consumer, or accumulates as a
 * pending change to be flushed as a single batch. `staged` is that mode, and it is
 * inferred from the handler set (a consumer that supplies `onCommitChanges` wants
 * batching) rather than from a mode flag the caller has to keep consistent.
 *
 * It also owns the invariants the counts depend on:
 *  - A row marked for deletion makes its own staged cell edits MOOT — they are not
 *    counted and never reach `updates`.
 *  - Toggling a delete off restores those edits (they were never discarded).
 *  - A failed commit (`false`) keeps the whole ledger so nothing is silently lost.
 *
 * The draft row and the open cell editor live here too: they are the entry points of
 * the same workflow (start → commit → stage → flush), not independent widget state.
 */
export function useRowMutations(columns: TableColumn[], handlers: RowMutationHandlers) {
  const { onCellEdit, onAddRow, onDeleteRow, onCommitChanges } = handlers
  const staged = !!onCommitChanges

  // The cell being edited in place (row by reference, column by id).
  const [editing, setEditingState] = useState<{ row: TableRow; columnId: string } | null>(null)
  // The draft new row being composed (keyed by column id), or null when not adding.
  const [draft, setDraftState] = useState<Record<string, string | null> | null>(null)
  // Staged changes awaiting an explicit Commit: cell edits keyed by row reference →
  // column id, appended inserts, and rows marked for deletion.
  const [pendingEdits, setPendingEdits] = useState<Map<TableRow, Record<string, string | null>>>(
    new Map(),
  )
  const [pendingInserts, setPendingInserts] = useState<PendingInsert[]>([])
  const nextInsertId = useRef(1)
  const [pendingDeletes, setPendingDeletes] = useState<Set<TableRow>>(new Set())
  const [committing, setCommitting] = useState(false)
  const committingRef = useRef(false)
  const setEditing = (next: SetStateAction<{ row: TableRow; columnId: string } | null>): void => {
    if (!committingRef.current) setEditingState(next)
  }
  const setDraft = (next: SetStateAction<Record<string, string | null> | null>): void => {
    if (!committingRef.current) setDraftState(next)
  }

  const commitEdit = (row: TableRow, columnId: string, next: string | null) => {
    if (committingRef.current) return
    setEditing(null)
    if (staged) {
      setPendingEdits((m) => {
        const nextMap = new Map(m)
        nextMap.set(row, { ...nextMap.get(row), [columnId]: next })
        return nextMap
      })
    } else {
      onCellEdit?.(row, columnId, next)
    }
  }

  // Toggle a row's staged-for-deletion mark (staged mode); immediate delete otherwise.
  const toggleDelete = (row: TableRow) => {
    if (committingRef.current) return
    if (staged) {
      setPendingDeletes((s) => {
        const next = new Set(s)
        if (next.has(row)) next.delete(row)
        else next.add(row)
        return next
      })
    } else {
      onDeleteRow?.(row)
    }
  }

  // A deleted row's cell edits are moot — count edits only for rows not marked for deletion.
  const editCellCount = Array.from(pendingEdits).reduce(
    (n, [row, v]) => n + (pendingDeletes.has(row) ? 0 : Object.keys(v).length),
    0,
  )
  const pendingCount = editCellCount + pendingInserts.length + pendingDeletes.size

  const clearStagedState = () => {
    setPendingEdits(new Map())
    setPendingInserts([])
    setPendingDeletes(new Set())
  }
  const clearStaged = () => {
    if (!committingRef.current) clearStagedState()
  }
  const removeInsert = (id: number) => {
    if (committingRef.current) return
    setPendingInserts((rows) => rows.filter((insert) => insert.id !== id))
  }

  const commitChanges = async () => {
    if (!onCommitChanges || pendingCount === 0 || committingRef.current) return
    committingRef.current = true
    setCommitting(true)
    try {
      const updates = Array.from(pendingEdits).flatMap(([row, values]) =>
        pendingDeletes.has(row) ? [] : [{ row, values }],
      )
      const ok = await onCommitChanges({
        updates,
        inserts: pendingInserts.map((insert) => insert.values),
        deletes: Array.from(pendingDeletes),
      })
      if (ok) clearStagedState()
    } finally {
      committingRef.current = false
      setCommitting(false)
    }
  }

  const startDraft = () => {
    if (committingRef.current) return
    setDraft(Object.fromEntries(columns.map((c) => [c.id, ''])))
  }
  const cancelDraft = () => {
    if (!committingRef.current) setDraft(null)
  }
  const commitDraft = () => {
    if (committingRef.current) return
    if (draft) {
      if (staged) {
        const id = nextInsertId.current++
        setPendingInserts((rows) => [...rows, { id, values: draft }])
      } else onAddRow?.(draft)
    }
    setDraft(null)
  }

  return {
    staged,
    editing,
    setEditing,
    commitEdit,
    draft,
    setDraft,
    startDraft,
    commitDraft,
    cancelDraft,
    pendingEdits,
    pendingInserts,
    pendingDeletes,
    toggleDelete,
    removeInsert,
    editCellCount,
    pendingCount,
    committing,
    clearStaged,
    commitChanges,
  }
}
