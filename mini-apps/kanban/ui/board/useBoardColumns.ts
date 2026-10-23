import { useCallback, useMemo, useState } from 'react'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import { COLUMNS } from './constants'
import { capColumn, KANBAN_COLUMN_CAP } from './columnCap'
import { flattenLeafIds } from './utils'
import { useStableIdSet } from './useStableIdSet'

export interface BoardColumns {
  /** Ids of done tasks, stable by CONTENT so a card's memo can bail out. */
  doneIds: Set<string>
  /** Non-epic children grouped by their parent epic. */
  childrenByEpic: Map<string, KanbanTask[]>
  /** What each column actually renders — a prefix of its sections. */
  renderedByStatus: Map<KanbanStatus, ReturnType<typeof capColumn>>
  /** Board reading order of the rendered leaf cards. */
  flatLeafIds: string[]
  /** Raise one column's render budget by another page. */
  showMoreInColumn: (status: KanbanStatus) => void
  /** Raise a column's budget to cover `total` cards — a keyboard move's destination. */
  ensureColumnShows: (status: KanbanStatus, total: number) => void
}

/**
 * What the board draws: every card grouped, ordered and capped per column.
 *
 * All of it is memoized on the task list and the filters rather than computed per
 * render, because the board re-renders on every drag-over frame (drop-indicator
 * churn) and on every board stream frame, and none of that changes the grouping.
 * Split out of the board component so its own file is composition and layout, and
 * so the identity discipline these values keep — which is what lets `memo(TaskCard)`
 * bail out — is stated in one place.
 */
export function useBoardColumns(
  tasks: KanbanTask[],
  leafTasks: KanbanTask[],
  epicById: Map<string, KanbanTask>,
  visible: KanbanTask[],
): BoardColumns {
  // Held by CONTENT, not by `tasks` identity: every stream frame is a new array,
  // and a fresh Set identity here would be a changed prop on every card and would
  // defeat `memo(TaskCard)` for the whole board (see `useStableIdSet`).
  const doneIds = useStableIdSet(
    useMemo(() => tasks.flatMap((task) => (task.status === 'done' ? [task.id] : [])), [tasks]),
  )

  // Built once per task change instead of re-filtering the whole list for every
  // epic card each render.
  const childrenByEpic = useMemo(() => {
    const map = new Map<string, KanbanTask[]>()
    for (const task of tasks) {
      if (task.kind === 'epic' || !task.parentTaskId) continue
      const list = map.get(task.parentTaskId)
      if (list) list.push(task)
      else map.set(task.parentTaskId, [task])
    }
    return map
  }, [tasks])

  const sectionsByStatus = useMemo(() => {
    const byStatus = new Map<
      KanbanStatus,
      {
        epicCards: KanbanTask[]
        groups: { epic: KanbanTask; tasks: KanbanTask[] }[]
        loose: KanbanTask[]
      }
    >()
    for (const { status } of COLUMNS) {
      const inColumn = leafTasks
        .filter((task) => task.status === status)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const groups = new Map<string, KanbanTask[]>()
      const loose: KanbanTask[] = []
      for (const task of inColumn) {
        if (task.parentTaskId && epicById.has(task.parentTaskId)) {
          const list = groups.get(task.parentTaskId)
          if (list) list.push(task)
          else groups.set(task.parentTaskId, [task])
        } else {
          loose.push(task)
        }
      }
      const epicCards = visible
        .filter((task) => task.kind === 'epic' && task.status === status)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      byStatus.set(status, {
        epicCards,
        groups: [...groups.entries()].map(([id, list]) => ({
          epic: epicById.get(id)!,
          tasks: list,
        })),
        loose,
      })
    }
    return byStatus
  }, [leafTasks, visible, epicById])

  // How many cards each column may render. Agents file tasks faster than humans
  // triage them, so a lane showing ~8 cards used to MOUNT every card it held; the
  // rest arrive a page at a time through the column's "show more".
  const [columnLimits, setColumnLimits] = useState<Partial<Record<KanbanStatus, number>>>({})
  const showMoreInColumn = useCallback((status: KanbanStatus) => {
    setColumnLimits((prev) => ({
      ...prev,
      [status]: (prev[status] ?? KANBAN_COLUMN_CAP) + KANBAN_COLUMN_CAP,
    }))
  }, [])
  const ensureColumnShows = useCallback((status: KanbanStatus, total: number) => {
    setColumnLimits((prev) =>
      (prev[status] ?? KANBAN_COLUMN_CAP) >= total ? prev : { ...prev, [status]: total },
    )
  }, [])

  // A PREFIX of each column's sections, so a drop index computed from the rendered
  // cards is still the right logical index.
  const renderedByStatus = useMemo(() => {
    const byStatus = new Map<KanbanStatus, ReturnType<typeof capColumn>>()
    for (const { status } of COLUMNS) {
      byStatus.set(
        status,
        capColumn(sectionsByStatus.get(status)!, columnLimits[status] ?? KANBAN_COLUMN_CAP),
      )
    }
    return byStatus
  }, [sectionsByStatus, columnLimits])

  // Built from what is RENDERED so a Shift-click range can never span a card the
  // user cannot see.
  const flatLeafIds = useMemo(
    () =>
      flattenLeafIds(
        renderedByStatus,
        COLUMNS.map((c) => c.status),
      ),
    [renderedByStatus],
  )

  return {
    doneIds,
    childrenByEpic,
    renderedByStatus,
    flatLeafIds,
    showMoreInColumn,
    ensureColumnShows,
  }
}
