import { expect, test } from 'bun:test'

import type { KanbanTask } from './contracts'
import { takeEligibility } from './rules'

test('a dependency refusal names each dependency state', () => {
  const task = { id: 'LX-3', kind: 'task', status: 'backlog', dependsOn: ['LX-1', 'LX-2'] }
  const board = [
    { id: 'LX-1', status: 'in_progress' },
    { id: 'LX-2', status: 'review' },
  ] as Pick<KanbanTask, 'id' | 'status'>[]
  const refused = takeEligibility(task as unknown as KanbanTask, board)
  expect(refused).toMatchObject({ ok: false, reason: 'dependencies' })
  expect(refused.ok ? '' : refused.why).toBe(
    'LX-3 has unfinished dependencies: LX-1 (in progress), LX-2 (review). Take it once they are done.',
  )
})
