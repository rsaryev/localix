import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createUsageRepository } from './repository'

/**
 * `session` and `sessionTree` answer different questions, and both are wanted.
 *
 * A child's tokens are written against the CHILD's session id while the work was done for the
 * parent's objective. So anything listing sessions individually wants the exact filter, and
 * anything bounding a session's work wants the tree.
 * Measured before the fix: a session that had spent 1000 tokens across one delegated child
 * reported 100, so a 500-token budget never fired however much delegated work ran.
 */
describe('usage filters: one session versus its whole tree', () => {
  let db: ReturnType<typeof createDatabase>
  let repo: ReturnType<typeof createUsageRepository>
  const dir = join(tmpdir(), `localix-usage-session-tree-tests-${process.pid}`)
  const userId = 'u-tree'

  const tokensFor = async (filter: { session?: string; sessionTree?: string }) => {
    const rows = await repo.queryStats({ userId, ...filter, groupBy: 'kind' })
    return rows.find((row) => row.key === 'turn')?.totalTokens ?? 0
  }

  beforeAll(async () => {
    await mkdir(dir, { recursive: true })
    db = createDatabase({ filename: join(dir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    repo = createUsageRepository(db)
    // A root, a delegated child, and a grandchild — `root_session_id` is inherited from the
    // parent's root, so it names the TOP of the tree even two levels down.
    for (const [sessionId, tokens] of [
      ['root', 100],
      ['child', 400],
      ['grandchild', 500],
    ] as const) {
      await repo.recordEvent({
        messageId: `m-${sessionId}`,
        sessionId,
        rootSessionId: 'root',
        userId,
        modelId: 'test/model',
        totalTokens: tokens,
        finishReason: 'end_turn',
      })
    }
  })

  afterAll(async () => {
    await destroyDatabase(db)
    await rm(dir, { recursive: true, force: true })
  })

  test('the exact filter sees one session, which is what a per-session list wants', async () => {
    expect(await tokensFor({ session: 'root' })).toBe(100)
    expect(await tokensFor({ session: 'child' })).toBe(400)
  })

  test('the tree filter sees every descendant, including a grandchild', async () => {
    expect(await tokensFor({ sessionTree: 'root' })).toBe(1000)
  })

  test('a row is counted once, not once per matching column', async () => {
    // The root's own rows carry their own id as `root_session_id`, so the OR could double
    // count if it were expressed as a union rather than a predicate.
    expect(await tokensFor({ sessionTree: 'root' })).toBe(1000)
  })

  test('the tree filter does not reach sideways', async () => {
    // A sibling tree must not be swept in by a filter meant to bound one objective.
    await repo.recordEvent({
      messageId: 'm-other',
      sessionId: 'other',
      rootSessionId: 'other',
      userId,
      modelId: 'test/model',
      totalTokens: 7,
      finishReason: 'end_turn',
    })
    expect(await tokensFor({ sessionTree: 'root' })).toBe(1000)
    expect(await tokensFor({ sessionTree: 'other' })).toBe(7)
  })
})
