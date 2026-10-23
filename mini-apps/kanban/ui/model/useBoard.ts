import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'

import type { KanbanTask } from '../../shared/contracts'
import {
  getBoardState,
  reconcileBoard,
  setBoardTasks,
  subscribeBoard,
  type BoardState,
} from './boardStore'

/**
 * The React side of the per-chat board mirror (`boardStore.ts`).
 *
 * A hidden surface stays attached to nothing: it keeps rendering the cached cards (better than a
 * skeleton) but neither reads nor holds the stream open. A surface that belongs to no chat
 * (`sessionId` null) has no board at all and reads the empty state.
 */

const NO_BOARD: BoardState = Object.freeze({ tasks: [], error: null, settled: true }) as BoardState
const noop = () => {}

export interface BoardTasks {
  tasks: KanbanTask[]
  error: string | null
  /** True until the first read settles, so an empty column is not claimed before it is known. */
  loading: boolean
  setTasks: (update: KanbanTask[] | ((prev: KanbanTask[]) => KanbanTask[])) => void
  reconcile: () => Promise<void>
}

/** The whole board. Re-renders on every card change — the board itself, not a task tab. */
export function useBoardTasks(sessionId: string | null): BoardTasks {
  const visible = useWorkItemVisible()
  const subscribe = useCallback(
    (onChange: () => void) => (sessionId && visible ? subscribeBoard(sessionId, onChange) : noop),
    [sessionId, visible],
  )
  const read = useCallback(() => (sessionId ? getBoardState(sessionId) : NO_BOARD), [sessionId])
  const state = useSyncExternalStore(subscribe, read, read)
  const setTasks = useCallback<BoardTasks['setTasks']>(
    (update) => {
      if (sessionId) setBoardTasks(sessionId, update)
    },
    [sessionId],
  )
  const reconcile = useCallback(
    () => (sessionId ? reconcileBoard(sessionId) : Promise.resolve()),
    [sessionId],
  )
  return { tasks: state.tasks, error: state.error, loading: !state.settled, setTasks, reconcile }
}

/**
 * Watch one SLICE of a board. A task tab wants its parent, its children and whether its
 * dependencies are done; reading the whole list would re-render it on every frame about any card.
 * `isEqual` is what actually stops the render, so a selector returning a fresh array needs one
 * that compares contents.
 */
export function useBoardSlice<T>(
  sessionId: string | null,
  select: (state: BoardState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const visible = useWorkItemVisible()
  const selectRef = useRef(select)
  const isEqualRef = useRef(isEqual)
  useEffect(() => {
    selectRef.current = select
    isEqualRef.current = isEqual
  })
  const [slice, setSlice] = useState(() => select(sessionId ? getBoardState(sessionId) : NO_BOARD))
  const sliceRef = useRef(slice)

  useEffect(() => {
    if (!sessionId || !visible) return
    const read = () => {
      const next = selectRef.current(getBoardState(sessionId))
      if (isEqualRef.current(sliceRef.current, next)) return
      sliceRef.current = next
      setSlice(next)
    }
    const release = subscribeBoard(sessionId, read)
    // The mirror may already hold the board (another surface read it), or it landed between the
    // first render and this subscribe.
    read()
    return release
  }, [sessionId, visible, select])

  return slice
}

const sameCards = (a: readonly KanbanTask[], b: readonly KanbanTask[]): boolean =>
  a.length === b.length && a.every((task, index) => task === b[index])

/** One card of a board, by id — `undefined` until the board is read, or when it is gone. */
export function useBoardTask(sessionId: string | null, id: string | null | undefined) {
  const select = useCallback(
    (state: BoardState) => (id ? state.tasks.find((task) => task.id === id) : undefined),
    [id],
  )
  return useBoardSlice(sessionId, select)
}

/** An epic's tasks, in board order. */
export function useBoardChildren(sessionId: string | null, epicId: string | null | undefined) {
  const select = useCallback(
    (state: BoardState) =>
      epicId ? state.tasks.filter((task) => task.parentTaskId === epicId) : [],
    [epicId],
  )
  return useBoardSlice(sessionId, select, sameCards)
}

/** The cards behind a list of ids, in the order asked for, skipping ids the board lacks. */
export function useBoardTasksByIds(sessionId: string | null, ids: readonly string[]) {
  const key = ids.join(',')
  const select = useCallback(
    (state: BoardState) =>
      (key ? key.split(',') : []).flatMap((id) => {
        const task = state.tasks.find((candidate) => candidate.id === id)
        return task ? [task] : []
      }),
    [key],
  )
  return useBoardSlice(sessionId, select, sameCards)
}

/** Which of `ids` are `done`; the set changes only when one of those cards actually flips. */
export function useBoardDoneIds(sessionId: string | null, ids: readonly string[]) {
  const key = [...ids].sort().join(',')
  const select = useCallback(
    (state: BoardState) => {
      const wanted = new Set(key ? key.split(',') : [])
      return new Set(
        state.tasks.flatMap((task) =>
          task.status === 'done' && wanted.has(task.id) ? [task.id] : [],
        ),
      )
    },
    [key],
  )
  return useBoardSlice(
    sessionId,
    select,
    (a, b) => a.size === b.size && [...a].every((id) => b.has(id)),
  )
}

/** Every label in use on a board, most used first — the label editor's suggestions. */
export function boardLabels(tasks: readonly KanbanTask[]): string[] {
  const counts = new Map<string, number>()
  for (const task of tasks)
    for (const label of task.labels) counts.set(label, (counts.get(label) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([label]) => label)
}

const sameStrings = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index])

const selectLabels = (state: BoardState) => boardLabels(state.tasks)

export function useBoardLabels(sessionId: string | null): string[] {
  return useBoardSlice(sessionId, selectLabels, sameStrings)
}
