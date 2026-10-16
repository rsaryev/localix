import { describe, expect, test } from 'bun:test'

import type { KanbanTask } from '../../shared/contracts'
import { capColumn, KANBAN_COLUMN_CAP, type ColumnSections } from './columnCap'

const task = (id: string): KanbanTask =>
  ({ id, kind: 'task', status: 'backlog', sortOrder: Number(id.split('-')[1]), title: id }) as never

const tasks = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => task(`${prefix}-${i}`))

const sections = (over: Partial<ColumnSections> = {}): ColumnSections => ({
  epicCards: [],
  groups: [],
  loose: [],
  ...over,
})

/**
 * The board's bound. Two properties matter and both are load-bearing:
 *
 *  - the column stops mounting cards at the cap, and says how many it holds back;
 *  - what it renders is a PREFIX of the logical sections. `useKanbanDrag` computes a
 *    drop index by counting rendered `[data-task-card]` nodes and applies it to the
 *    logical section list, so rendered index N must be logical index N. Anything that
 *    reordered or windowed the cards would silently move dropped cards to the wrong
 *    place — which is why this is a cap and not a virtual window.
 */
describe('capColumn', () => {
  test('a column under the cap is untouched and reports nothing hidden', () => {
    const input = sections({ loose: tasks('loose', 10), epicCards: tasks('epic', 2) })
    const capped = capColumn(input, KANBAN_COLUMN_CAP)
    expect(capped.loose).toEqual(input.loose)
    expect(capped.epicCards).toEqual(input.epicCards)
    expect(capped.hidden).toBe(0)
    expect(capped.total).toBe(12)
  })

  test('a column over the cap renders exactly the cap and counts the rest', () => {
    const capped = capColumn(sections({ loose: tasks('loose', 400) }), KANBAN_COLUMN_CAP)
    expect(capped.loose.length).toBe(KANBAN_COLUMN_CAP)
    expect(capped.hidden).toBe(400 - KANBAN_COLUMN_CAP)
    // The count in the column header keeps describing every card the column holds.
    expect(capped.total).toBe(400)
  })

  test('what renders is the prefix of the logical list — a drop index still maps', () => {
    // MUTATION: slice from the tail (`loose.slice(-limit)`) → red. That is the bug a
    // virtual window would introduce: rendered index 3 would be logical index 343.
    const input = sections({ loose: tasks('loose', 400) })
    const capped = capColumn(input, KANBAN_COLUMN_CAP)
    capped.loose.forEach((card, index) => expect(card.id).toBe(input.loose[index]!.id))
  })

  test('the budget is spent in reading order: epics, then groups, then loose', () => {
    const input = sections({
      epicCards: tasks('epic', 2),
      groups: [
        { epic: task('e-0'), tasks: tasks('a', 3) },
        { epic: task('e-1'), tasks: tasks('b', 3) },
      ],
      loose: tasks('loose', 10),
    })
    const capped = capColumn(input, 7)
    expect(capped.epicCards.length).toBe(2)
    expect(capped.groups.map((g) => g.tasks.length)).toEqual([3, 2])
    expect(capped.loose).toEqual([])
    expect(capped.hidden).toBe(11)
  })

  test('a group with no budget left is dropped whole, not rendered empty', () => {
    const input = sections({
      groups: [
        { epic: task('e-0'), tasks: tasks('a', 3) },
        { epic: task('e-1'), tasks: tasks('b', 3) },
      ],
    })
    const capped = capColumn(input, 3)
    expect(capped.groups.map((g) => g.epic.id)).toEqual(['e-0'])
    expect(capped.hidden).toBe(3)
  })

  test('pressing "show more" once reveals another page and shrinks the hidden count', () => {
    const input = sections({ loose: tasks('loose', 400) })
    const first = capColumn(input, KANBAN_COLUMN_CAP)
    const second = capColumn(input, KANBAN_COLUMN_CAP * 2)
    expect(second.loose.length).toBe(first.loose.length + KANBAN_COLUMN_CAP)
    expect(second.hidden).toBe(first.hidden - KANBAN_COLUMN_CAP)
    // Still a prefix, so the second page continues where the first stopped.
    expect(second.loose.slice(0, KANBAN_COLUMN_CAP)).toEqual(first.loose)
  })

  test('an empty column stays empty rather than reporting hidden cards', () => {
    const capped = capColumn(sections(), KANBAN_COLUMN_CAP)
    expect(capped.total).toBe(0)
    expect(capped.hidden).toBe(0)
  })
})
