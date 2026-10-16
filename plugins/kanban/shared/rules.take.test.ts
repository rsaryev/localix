import { expect, test } from 'bun:test'

import type { KanbanTask } from './contracts'
import { takeEligibility } from './rules'

// LOCALIX-386/388: a member saw "unfinished dependencies: LX-2" while LX-2 sat in review, and
// retried take; the refusal now says the dependency waits for the leader.
test('a dependency refusal names each dependency state, and review as waiting on the leader', () => {
  const task = { id: 'LX-3', kind: 'task', status: 'backlog', dependsOn: ['LX-1', 'LX-2'] }
  const board = [
    { id: 'LX-1', status: 'in_progress' },
    { id: 'LX-2', status: 'review' },
  ] as Pick<KanbanTask, 'id' | 'status'>[]
  const refused = takeEligibility(task as unknown as KanbanTask, board)
  expect(refused).toMatchObject({ ok: false, reason: 'dependencies' })
  expect(refused.ok ? '' : refused.why).toBe(
    'LX-3 has unfinished dependencies: LX-1 (in progress), LX-2 (in review — the leader completes it after verifying). Take it once they are done.',
  )
})
