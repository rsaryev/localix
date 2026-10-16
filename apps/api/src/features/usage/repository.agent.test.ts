import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test, beforeAll } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createUsageRepository } from './repository'

const tempDir = join(process.cwd(), 'tmp', 'usage-agent-tests')

/**
 * Per-participant accounting. A group chat runs several agents over ONE session, so
 * `session_id` stops answering "who spent this" and `model_id` answers it only while two
 * members happen to run different models — these cases use one model for the whole party so
 * a regression to model-based attribution cannot pass.
 */
describe('usage repository — spend by party member', () => {
  let db: any
  let repo: ReturnType<typeof createUsageRepository>
  const userId = 'user_agents'

  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
    db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    repo = createUsageRepository(db)

    await db
      .insertInto('agent_sessions')
      .values({
        id: 'room',
        user_id: userId,
        project_id: 'PRJ-test',
        title: 'Room',
        root_session_id: 'room',
      })
      .execute()
    await db
      .insertInto('conversation_participants')
      .values([
        {
          session_id: 'room',
          agent_id: 'builtin:lead',
          handle: 'lead',
          position: 0,
          model_id: 'test/one-model',
        },
        {
          session_id: 'room',
          agent_id: 'builtin:qa',
          handle: 'qa',
          position: 1,
          model_id: 'test/one-model',
        },
      ])
      .execute()

    const spend = [
      { messageId: 'm1', agentId: 'builtin:lead', costUsd: 3, totalTokens: 300 },
      { messageId: 'm2', agentId: 'builtin:qa', costUsd: 1, totalTokens: 100 },
      { messageId: 'm3', agentId: 'builtin:qa', costUsd: 1, totalTokens: 100 },
      // An auxiliary call has no speaker of its own; it must not be attributed to anyone.
      { messageId: 'title-room', agentId: null, costUsd: 0.5, totalTokens: 50 },
    ]
    for (const row of spend) {
      await repo.recordEvent({
        messageId: row.messageId,
        sessionId: 'room',
        userId,
        modelId: 'test/one-model',
        agentId: row.agentId,
        totalTokens: row.totalTokens,
        costUsd: row.costUsd,
      })
    }
  })

  test('groups one session’s spend by the member that produced it', async () => {
    const stats = await repo.queryStats({ userId, groupBy: 'agent' })
    expect(stats.map((row) => [row.key, row.costUsd, row.messages])).toEqual([
      ['builtin:lead', 3, 1],
      ['builtin:qa', 2, 2],
      // The unattributed auxiliary row keeps its own bucket rather than being dropped: the
      // breakdown has to still add up to the summary total.
      ['unknown', 0.5, 1],
    ])
  })

  test('filters every aggregate down to one member', async () => {
    const summary = await repo.querySummary({ userId, agent: 'builtin:qa' })
    expect(summary).toMatchObject({ messages: 2, costUsd: 2, totalTokens: 200 })
    const logs = await repo.queryLogs({ userId, agent: 'builtin:qa' })
    expect(logs.rows.map((r) => r.messageId).sort()).toEqual(['m2', 'm3'])
    expect(logs.rows.every((r) => r.agentId === 'builtin:qa')).toBe(true)
  })

  test('names each spending member by the handle its seat recorded', async () => {
    const keys = await repo.queryKeys(userId)
    expect(keys.agents).toEqual([
      { id: 'builtin:lead', handle: 'lead' },
      { id: 'builtin:qa', handle: 'qa' },
    ])
  })

  test('a re-persist of the same message keeps one row and re-attributes it', async () => {
    // The streaming → final write path UPSERTs by message id. The speaker is re-derived on
    // every write, so the last one wins rather than leaving the first attribution frozen.
    await repo.recordEvent({
      messageId: 'm1',
      sessionId: 'room',
      userId,
      modelId: 'test/one-model',
      agentId: 'builtin:qa',
      totalTokens: 300,
      costUsd: 3,
    })
    const summary = await repo.querySummary({ userId, agent: 'builtin:lead' })
    expect(summary.messages).toBe(0)
    expect((await repo.querySummary({ userId, agent: 'builtin:qa' })).messages).toBe(3)
  })
})
