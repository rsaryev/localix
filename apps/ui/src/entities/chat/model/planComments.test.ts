import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import type { CommentView, SessionPlan } from '@localixai/api/client'
import { backendClient } from '@/shared/api/client'

import { decideCarryOver, quoteStillPresent } from './planCommentCarry'
import {
  carryOverComments,
  planCommentActions,
  resetPlanCommentsForTest,
  usePlanCommentsStore,
} from './planComments'

const comment = (over: Partial<CommentView> = {}): CommentView => ({
  id: 'c1',
  scope: 'plan:p1',
  anchor: { quote: 'Use Redis for the cache.' },
  body: 'Why not in-process?',
  status: 'open',
  createdAt: '2026-10-03T00:00:00.000Z',
  updatedAt: '2026-10-03T00:00:00.000Z',
  ...over,
})

const plan = (id: string, version: number, body: string): SessionPlan => ({
  id,
  sessionId: 'root',
  version,
  status: version === 2 ? 'presented' : 'superseded',
  title: 'Cache',
  body,
  authorAgentId: 'lead',
  approvedMode: null,
  createdAt: '2026-10-03T00:00:00.000Z',
  decidedAt: null,
  completedAt: null,
  completionSummary: null,
  filePath: `/work/.localix/plans/ROOT/v${version}.md`,
  dismissedBy: null,
})

const target = backendClient as unknown as Record<string, unknown>
let originals: Record<string, unknown> = {}
function stub(stubs: Record<string, unknown>) {
  for (const key of Object.keys(stubs)) if (!(key in originals)) originals[key] = target[key]
  Object.assign(target, stubs)
}

beforeEach(() => resetPlanCommentsForTest())
afterEach(() => {
  Object.assign(target, originals)
  originals = {}
})

const scopeOf = (scope: string) => usePlanCommentsStore.getState().byScope[scope] ?? []

describe('plan comment persistence', () => {
  test('adding writes to the server first and keeps only what it answered', async () => {
    const createComment = mock(async () => comment({ id: 'srv-1' }))
    stub({ createComment })
    await planCommentActions.add('p1', 'Use Redis for the cache.', 'Why not in-process?')
    expect(createComment).toHaveBeenCalledWith(
      'plan:p1',
      { quote: 'Use Redis for the cache.' },
      'Why not in-process?',
    )
    expect(scopeOf('plan:p1').map((c) => c.id)).toEqual(['srv-1'])
  })

  test('a failed add leaves nothing behind that looks saved', async () => {
    stub({
      createComment: mock(async () => {
        throw new Error('offline')
      }),
    })
    await expect(planCommentActions.add('p1', 'q', 'note')).rejects.toThrow('offline')
    expect(scopeOf('plan:p1')).toEqual([])
  })

  test('deleting removes the row on the server, then from the cache', async () => {
    const deleteComment = mock(async () => {})
    stub({ deleteComment })
    usePlanCommentsStore.getState().setScope('plan:p1', [comment()])
    await planCommentActions.remove(comment())
    expect(deleteComment).toHaveBeenCalledWith('c1')
    expect(scopeOf('plan:p1')).toEqual([])
  })

  test('a new version takes the unsent comments it still contains and marks the rest outdated', async () => {
    const kept = comment({ id: 'kept', anchor: { quote: 'Use Redis for the cache.' } })
    const gone = comment({ id: 'gone', anchor: { quote: 'Shard by tenant.' } })
    const sent = comment({ id: 'sent', status: 'sent', anchor: { quote: 'Shard by tenant.' } })
    const listComments = mock(async () => [kept, gone, sent])
    const createComment = mock(async (scope: string, anchor: { quote: string }, body: string) =>
      comment({ id: 'moved', scope, anchor: { ...anchor }, body }),
    )
    const deleteComment = mock(async () => {})
    const updateComment = mock(async (id: string, patch: { status?: string }) =>
      comment({ id, anchor: gone.anchor, status: patch.status as CommentView['status'] }),
    )
    stub({ listComments, createComment, deleteComment, updateComment })

    const v1 = plan('p1', 1, '## Cache\nUse Redis for the cache.\n\nShard by tenant.')
    const v2 = plan('p2', 2, '## Cache\n**Use Redis** for the cache.\n\nOne shard.')
    await carryOverComments(v1, v2)

    // Still in v2 (through the emphasis): moved, created before the old row is deleted.
    expect(createComment).toHaveBeenCalledWith(
      'plan:p2',
      { quote: 'Use Redis for the cache.' },
      kept.body,
    )
    expect(deleteComment).toHaveBeenCalledWith('kept')
    // Gone from v2: kept as outdated, never deleted. A sent one is history and is not touched.
    expect(updateComment).toHaveBeenCalledWith('gone', { status: 'outdated' })
    expect(updateComment).toHaveBeenCalledTimes(1)
    expect(scopeOf('plan:p2').map((c) => c.id)).toEqual(['moved'])
    expect(scopeOf('plan:p1').map((c) => [c.id, c.status])).toEqual([
      ['gone', 'outdated'],
      ['sent', 'sent'],
    ])

    // Once per version: a second composer mounting the same strip does not move anything again.
    await carryOverComments(v1, v2)
    expect(createComment).toHaveBeenCalledTimes(1)
  })
})

describe('matching a rendered quote against markdown', () => {
  test('ignores markup and link targets, and refuses an empty quote', () => {
    expect(quoteStillPresent('See the docs now.', 'See the [docs](https://x.y) now.')).toBe(true)
    expect(quoteStillPresent('Run the migration', '1. Run the `migration` first')).toBe(true)
    expect(quoteStillPresent('Shard by tenant.', 'One shard.')).toBe(false)
    expect(quoteStillPresent('   ', 'anything')).toBe(false)
  })

  test('only open comments are decided', () => {
    const decision = decideCarryOver(
      [comment({ status: 'sent' }), comment({ id: 'o', status: 'outdated' })],
      'Use Redis for the cache.',
    )
    expect(decision).toEqual({ carry: [], outdated: [] })
  })
})
