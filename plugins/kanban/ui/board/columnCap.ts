import type { KanbanTask } from '../../shared/contracts'

/** The three card sections a column renders, in board reading order. */
export interface ColumnSections {
  epicCards: KanbanTask[]
  groups: { epic: KanbanTask; tasks: KanbanTask[] }[]
  loose: KanbanTask[]
}

export interface CappedColumn extends ColumnSections {
  /** Cards the column holds but does not render (0 = the whole column is rendered). */
  hidden: number
  /** Every card in the column, rendered or not — what the column count shows. */
  total: number
}

/**
 * How many cards a column renders before it stops and offers "show more". Also the
 * step each press of that button adds.
 *
 * A board with a large `backlog` (agents file tasks faster than humans triage them)
 * rendered every card in every column: the lane is a ~600-pixel scroller showing
 * about eight cards, so a 400-card backlog mounted 400 cards to show eight.
 *
 * The bound is a CAP rather than a virtual window because the column's drop index is
 * computed by scanning its `[data-task-card]` nodes (`useKanbanDrag.onSectionDragOver`)
 * and applied to the logical section list. A cap keeps that mapping exact — the
 * rendered cards are a PREFIX of the logical list, so rendered index N is logical
 * index N — while a window would offset every index by its first mounted row and
 * would have to unmount the card being dragged. Correct and bounded beats windowed
 * and subtly wrong; see docs/internals/ui-virtualization.md.
 */
export const KANBAN_COLUMN_CAP = 60

/**
 * Render budget applied to one column's sections, in reading order: epic cards, then
 * each epic group's tasks, then the loose cards. Sections keep their order and their
 * prefix, so the first `limit` cards are exactly the first `limit` cards the uncapped
 * column would have shown. An epic group whose budget ran out is dropped whole rather
 * than rendered as an empty group header. Pure.
 */
export function capColumn(sections: ColumnSections, limit: number): CappedColumn {
  const total =
    sections.epicCards.length +
    sections.groups.reduce((sum, group) => sum + group.tasks.length, 0) +
    sections.loose.length
  if (total <= limit) return { ...sections, hidden: 0, total }

  let budget = Math.max(0, limit)
  const epicCards = sections.epicCards.slice(0, budget)
  budget -= epicCards.length

  const groups: ColumnSections['groups'] = []
  for (const group of sections.groups) {
    if (budget <= 0) break
    const tasks = group.tasks.slice(0, budget)
    budget -= tasks.length
    groups.push({ epic: group.epic, tasks })
  }

  const loose = sections.loose.slice(0, budget)
  return { epicCards, groups, loose, hidden: total - Math.max(0, limit), total }
}
