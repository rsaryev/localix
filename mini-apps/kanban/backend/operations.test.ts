import { describe, expect, test } from 'bun:test'

import { EMPTY_BOARD, type KanbanBoard } from '../shared/contracts'
import { BoardRefusal } from '../shared/errors'
import {
  applyMoves,
  createTask,
  nextStamp,
  removeTask,
  takeTask,
  updateTask,
  type TaskFields,
} from './operations'

const NOW = '2026-09-26T10:00:00.000Z'
const unassigned = { agentId: null, assignee: null }

const fields = (overrides: Partial<TaskFields> = {}): TaskFields => ({
  title: 'Task',
  description: '',
  status: 'backlog',
  kind: 'task',
  parentTaskId: null,
  dependsOn: [],
  attachedPaths: [],
  labels: [],
  priority: 0,
  subtasks: [],
  ...overrides,
})

function boardOf(...entries: Partial<TaskFields>[]): KanbanBoard {
  let board = EMPTY_BOARD
  for (const entry of entries)
    board = createTask(board, fields(entry), unassigned, 'agent', NOW).board
  return board
}

const refusalOf = (work: () => unknown): BoardRefusal => {
  try {
    work()
  } catch (error) {
    if (error instanceof BoardRefusal) return error
    throw error
  }
  throw new Error('expected a refusal')
}

describe('createTask', () => {
  test('numbers cards per board and never reuses a number', () => {
    const board = boardOf({ title: 'a' }, { title: 'b' })
    expect(board.tasks.map((task) => task.id)).toEqual(['LX-1', 'LX-2'])
    const pruned = removeTask(board, 'LX-2', NOW).board
    expect(createTask(pruned, fields(), unassigned, 'user', NOW).task.id).toBe('LX-3')
  })

  test('appends to the end of its column', () => {
    const board = boardOf({ title: 'a' }, { title: 'b' })
    expect(board.tasks.map((task) => task.sortOrder)).toEqual([1, 2])
  })

  test('refuses a dependency that is not on the board — it would wait forever', () => {
    expect(refusalOf(() => boardOf({ dependsOn: ['LX-9'] })).code).toBe('unknown_dependency')
  })

  test('refuses a parent that is not an epic', () => {
    const board = boardOf({ title: 'plain' })
    const refusal = refusalOf(() =>
      createTask(board, fields({ parentTaskId: 'LX-1' }), unassigned, 'agent', NOW),
    )
    expect(refusal.code).toBe('task_parent')
  })
})

describe('updateTask', () => {
  test('refuses a stale edit token', () => {
    const board = boardOf({})
    const refusal = refusalOf(() =>
      updateTask(board, 'LX-1', { title: 'x' }, { actor: 'user', expectedUpdatedAt: 'old' }, NOW),
    )
    expect(refusal.code).toBe('task_changed')
  })

  test('two writes in one millisecond still get distinct edit tokens', () => {
    const board = boardOf({})
    const first = updateTask(board, 'LX-1', { title: 'a' }, { actor: 'user' }, NOW)
    const second = updateTask(first.board, 'LX-1', { title: 'b' }, { actor: 'user' }, NOW)
    expect(second.task.updatedAt > first.task.updatedAt).toBe(true)
  })

  test('refuses a dependency cycle', () => {
    let board = boardOf({ title: 'a' }, { title: 'b', dependsOn: ['LX-1'] })
    const refusal = refusalOf(
      () =>
        (board = updateTask(board, 'LX-1', { dependsOn: ['LX-2'] }, { actor: 'agent' }, NOW).board),
    )
    expect(refusal.code).toBe('dependency_cycle')
  })

  test('a person cannot cancel a card and nobody reopens a cancelled one', () => {
    const board = boardOf({})
    expect(
      refusalOf(() => updateTask(board, 'LX-1', { status: 'cancelled' }, { actor: 'user' }, NOW))
        .code,
    ).toBe('forbidden_transition')
    const cancelled = updateTask(board, 'LX-1', { status: 'cancelled' }, { actor: 'agent' }, NOW)
    expect(
      refusalOf(() =>
        updateTask(cancelled.board, 'LX-1', { status: 'ready' }, { actor: 'agent' }, NOW),
      ).code,
    ).toBe('forbidden_transition')
  })

  test('moving a blocked card back to ready clears its blocker', () => {
    const blocked = updateTask(
      boardOf({}),
      'LX-1',
      { status: 'blocked', error: 'no key' },
      { actor: 'agent' },
      NOW,
    )
    const ready = updateTask(blocked.board, 'LX-1', { status: 'ready' }, { actor: 'user' }, NOW)
    expect(ready.task.error).toBeNull()
  })
})

describe('applyMoves', () => {
  test('one illegal move leaves the whole batch unapplied', () => {
    const board = boardOf({ title: 'a' }, { title: 'b' })
    const refusal = refusalOf(() =>
      applyMoves(
        board,
        [
          { id: 'LX-1', status: 'ready', sortOrder: 1 },
          { id: 'LX-2', status: 'cancelled', sortOrder: 2 },
        ],
        'user',
        NOW,
      ),
    )
    expect(refusal.code).toBe('forbidden_transition')
    expect(board.tasks.every((task) => task.status === 'backlog')).toBe(true)
  })

  test('refuses a batch naming one card twice', () => {
    const board = boardOf({})
    const move = { id: 'LX-1', status: 'ready' as const, sortOrder: 1 }
    expect(refusalOf(() => applyMoves(board, [move, move], 'user', NOW)).code).toBe(
      'duplicate_move',
    )
  })
})

describe('removeTask', () => {
  test('prunes the id from dependents and orphans the epic’s children', () => {
    const board = boardOf(
      { title: 'epic', kind: 'epic' },
      { title: 'child', parentTaskId: 'LX-1' },
      { title: 'dependent', dependsOn: ['LX-1'] },
    )
    const { board: next, pruned } = removeTask(board, 'LX-1', NOW)
    expect(next.tasks.map((task) => task.id)).toEqual(['LX-2', 'LX-3'])
    expect(pruned.map((task) => task.id)).toEqual(['LX-2', 'LX-3'])
    expect(next.tasks.find((task) => task.id === 'LX-2')?.parentTaskId).toBeNull()
    expect(next.tasks.find((task) => task.id === 'LX-3')?.dependsOn).toEqual([])
  })
})

describe('takeTask', () => {
  const taker = { agentId: 'builtin:localix', assignee: 'localix' }

  test('assigns the taker and moves the card to in_progress', () => {
    const { task } = takeTask(boardOf({}), 'LX-1', taker, NOW)
    expect(task).toMatchObject({
      status: 'in_progress',
      agentId: taker.agentId,
      assignee: 'localix',
    })
  })

  test('refuses while a dependency is unfinished', () => {
    const board = boardOf({ title: 'a' }, { title: 'b', dependsOn: ['LX-1'] })
    expect(refusalOf(() => takeTask(board, 'LX-2', taker, NOW)).code).toBe('task_dependencies')
  })

  test('refuses a card assigned to another agent', () => {
    const board = createTask(
      EMPTY_BOARD,
      fields(),
      { agentId: 'builtin:qa', assignee: 'qa' },
      'agent',
      NOW,
    ).board
    expect(refusalOf(() => takeTask(board, 'LX-1', taker, NOW)).code).toBe('task_assigned')
  })

  test('refuses an epic', () => {
    expect(refusalOf(() => takeTask(boardOf({ kind: 'epic' }), 'LX-1', taker, NOW)).code).toBe(
      'task_epic',
    )
  })
})

test('nextStamp moves forward even when the clock did not', () => {
  expect(nextStamp(NOW, NOW)).toBe('2026-09-26T10:00:00.001Z')
  expect(nextStamp('2026-09-26T10:00:01.000Z', NOW)).toBe('2026-09-26T10:00:01.000Z')
})
