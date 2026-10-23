import { describe, expect, test } from 'bun:test'

import type { KanbanStatus, KanbanTask } from '../../shared/contracts'
import { cardMenuItems } from './card-menu-items'

const task = (status: KanbanStatus): KanbanTask =>
  ({ id: 'LX-1', seq: 1, kind: 'task', status }) as KanbanTask

describe('cardMenuItems', () => {
  test('a lane lists every other column, in board order', () => {
    expect(cardMenuItems(task('ready'))).toEqual([
      { kind: 'open' },
      { kind: 'copy-ref' },
      { kind: 'move', to: 'backlog' },
      { kind: 'move', to: 'in_progress' },
      { kind: 'move', to: 'blocked' },
      { kind: 'move', to: 'review' },
      { kind: 'move', to: 'done' },
      { kind: 'delete' },
    ])
  })

  test('open / copy / delete are offered from every lane', () => {
    for (const status of ['backlog', 'ready', 'in_progress', 'done', 'cancelled'] as const) {
      const kinds = cardMenuItems(task(status)).map((item) => item.kind)
      expect(kinds[0]).toBe('open')
      expect(kinds).toContain('copy-ref')
      expect(kinds.at(-1)).toBe('delete')
    }
  })

  test('a cancelled card offers no move — the rules refuse every one', () => {
    expect(cardMenuItems(task('cancelled')).some((item) => item.kind === 'move')).toBe(false)
  })
})
