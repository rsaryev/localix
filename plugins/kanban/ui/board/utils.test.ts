import { describe, expect, test } from 'bun:test'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import {
  boardSummary,
  distributeSortOrders,
  flattenLeafIds,
  keyboardMoveTarget,
  quickAction,
  subtaskProgress,
  userMoveTargets,
} from './utils'

const task = (o: Partial<KanbanTask> = {}): KanbanTask =>
  ({ subtasks: [], kind: 'task', ...o }) as KanbanTask

describe('userMoveTargets', () => {
  test('in-progress is an ordinary board lane', () => {
    expect(userMoveTargets(task({ status: 'in_progress' }))).toEqual([
      'backlog',
      'ready',
      'blocked',
      'review',
      'done',
    ])
  })

  test('a lane offers every other board column, in board order', () => {
    expect(userMoveTargets(task({ status: 'backlog' }))).toEqual([
      'ready',
      'in_progress',
      'blocked',
      'review',
      'done',
    ])
    expect(userMoveTargets(task({ status: 'done' }))).toEqual([
      'backlog',
      'ready',
      'in_progress',
      'blocked',
      'review',
    ])
  })

  test('a cancelled card is closed: the rules refuse every move out of it, so none is offered', () => {
    expect(userMoveTargets(task({ status: 'cancelled' }))).toEqual([])
  })

  test('an epic is a container and is never offered in progress', () => {
    expect(userMoveTargets(task({ kind: 'epic', status: 'backlog' }))).not.toContain('in_progress')
  })

  test('never offers the column the card is already in', () => {
    for (const status of ['backlog', 'ready', 'blocked', 'done'] as const) {
      expect(userMoveTargets(task({ status }))).not.toContain(status)
    }
  })
})

describe('quickAction', () => {
  test('offers a → ready move only from user-triageable columns', () => {
    expect(quickAction(task({ status: 'backlog' }))?.to).toBe('ready')
    expect(quickAction(task({ status: 'blocked' }))?.to).toBe('ready')
    expect(quickAction(task({ status: 'done' }))?.to).toBe('ready')
    expect(quickAction(task({ status: 'review' }))?.to).toBe('done')
  })
  test('offers nothing on a cancelled card — the server refuses every move out of it', () => {
    expect(quickAction(task({ status: 'cancelled' }))).toBeNull()
  })
  test('offers nothing for cards already ready or in progress', () => {
    expect(quickAction(task({ status: 'ready' }))).toBeNull()
    expect(quickAction(task({ status: 'in_progress' }))).toBeNull()
  })
  test('never offers a quick action on an epic', () => {
    expect(quickAction(task({ kind: 'epic', status: 'backlog' }))).toBeNull()
  })
})

describe('keyboardMoveTarget', () => {
  test('walks every visible board lane', () => {
    expect(keyboardMoveTarget('backlog', 1)).toBe('ready')
    expect(keyboardMoveTarget('ready', 1)).toBe('in_progress')
    expect(keyboardMoveTarget('in_progress', 1)).toBe('blocked')
    expect(keyboardMoveTarget('blocked', 1)).toBe('review')
    expect(keyboardMoveTarget('review', 1)).toBe('done')
    expect(keyboardMoveTarget('done', -1)).toBe('review')
    expect(keyboardMoveTarget('blocked', -1)).toBe('in_progress')
    expect(keyboardMoveTarget('in_progress', -1)).toBe('ready')
    expect(keyboardMoveTarget('ready', -1)).toBe('backlog')
  })
  test('returns null at the ends of the track', () => {
    expect(keyboardMoveTarget('backlog', -1)).toBeNull()
    expect(keyboardMoveTarget('done', 1)).toBeNull()
  })
  test('returns null for cancelled cards', () => {
    expect(keyboardMoveTarget('cancelled', 1)).toBeNull()
  })
})

describe('distributeSortOrders', () => {
  test('a single card takes the midpoint, or one step past the edge', () => {
    expect(distributeSortOrders(2, 4, 1)).toEqual([3])
    expect(distributeSortOrders(2, undefined, 1)).toEqual([3])
    expect(distributeSortOrders(undefined, 4, 1)).toEqual([3])
    expect(distributeSortOrders(undefined, undefined, 1)).toEqual([1])
  })
  test('batch divides the gap evenly and stays strictly ascending between neighbours', () => {
    const orders = distributeSortOrders(0, 4, 3)
    expect(orders).toEqual([1, 2, 3])
    expect(orders.every((v, i) => i === 0 || v > orders[i - 1]!)).toBe(true)
  })
  test('batch below the last card ascends above `before`', () => {
    expect(distributeSortOrders(10, undefined, 3)).toEqual([11, 12, 13])
  })
  test('batch above the first card stays below `after`, ascending', () => {
    const orders = distributeSortOrders(undefined, 10, 3)
    expect(orders).toEqual([7, 8, 9])
    expect(orders.every((v) => v < 10)).toBe(true)
  })
  test('batch into an empty column starts at 1', () => {
    expect(distributeSortOrders(undefined, undefined, 3)).toEqual([1, 2, 3])
  })
})

describe('subtaskProgress', () => {
  test('counts done vs total', () => {
    expect(
      subtaskProgress(
        task({
          subtasks: [{ done: true }, { done: false }, { done: true }] as KanbanTask['subtasks'],
        }),
      ),
    ).toEqual({ done: 2, total: 3 })
    expect(subtaskProgress(task({}))).toEqual({ done: 0, total: 0 })
  })
})

describe('boardSummary', () => {
  test('rolls up leaf tasks by status; epics and cancelled excluded from total', () => {
    const tasks = [
      task({ kind: 'epic', status: 'ready' }),
      task({ status: 'done' }),
      task({ status: 'done' }),
      task({ status: 'in_progress' }),
      task({ status: 'blocked' }),
      task({ status: 'ready' }),
      task({ status: 'cancelled' }),
    ]
    expect(boardSummary(tasks)).toEqual({ total: 5, done: 2, blocked: 1, inProgress: 1 })
  })

  test('empty board is all zeroes', () => {
    expect(boardSummary([])).toEqual({ total: 0, done: 0, blocked: 0, inProgress: 0 })
  })
})

describe('flattenLeafIds', () => {
  const id = (x: string) => ({ id: x }) as KanbanTask
  const columns: KanbanStatus[] = ['backlog', 'ready', 'done']

  test('walks columns in order, epic-grouped before loose within each', () => {
    const sections = new Map([
      ['backlog', { groups: [{ tasks: [id('g1'), id('g2')] }], loose: [id('l1')] }],
      ['ready', { groups: [], loose: [id('r1'), id('r2')] }],
      ['done', { groups: [], loose: [] }],
    ]) as Parameters<typeof flattenLeafIds>[0]
    expect(flattenLeafIds(sections, columns)).toEqual(['g1', 'g2', 'l1', 'r1', 'r2'])
  })

  test('skips columns absent from the map', () => {
    const sections = new Map([['ready', { groups: [], loose: [id('r1')] }]]) as Parameters<
      typeof flattenLeafIds
    >[0]
    expect(flattenLeafIds(sections, columns)).toEqual(['r1'])
  })
})
