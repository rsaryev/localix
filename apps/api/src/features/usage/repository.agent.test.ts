import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test, beforeAll } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createUsageRepository } from './repository'

const tempDir = join(tmpdir(), `localix-usage-agent-tests-${process.pid}`)

/**
 * Per-agent accounting. Subagents run in child sessions of their own, but an event still names
 * the agent that spent it — these cases use one model for every agent so a regression to
 * model-based attribution cannot pass.
 */
describe('usage repository — spend by agent', () => {
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
      .values(
        [
          ['lead-session', 'builtin:lead', 'lead'],
          ['qa-session', 'builtin:qa', 'qa'],
        ].map(([id, agentId, name]) => ({
          id: id!,
          user_id: userId,
          project_id: 'PRJ-test',
          title: id!,
          root_session_id: id!,
          agent_id: agentId!,
          agent_name: name!,
          model_id: 'test/one-model',
        })),
      )
      .execute()

    const spend = [
      {
        messageId: 'm1',
        sessionId: 'lead-session',
        agentId: 'builtin:lead',
        costUsd: 3,
        totalTokens: 300,
      },
      {
        messageId: 'm2',
        sessionId: 'qa-session',
        agentId: 'builtin:qa',
        costUsd: 1,
        totalTokens: 100,
      },
      {
        messageId: 'm3',
        sessionId: 'qa-session',
        agentId: 'builtin:qa',
        costUsd: 1,
        totalTokens: 100,
      },
      // An auxiliary call has no speaker of its own; it must not be attributed to anyone.
      {
        messageId: 'title-room',
        sessionId: 'lead-session',
        agentId: null,
        costUsd: 0.5,
        totalTokens: 50,
      },
    ]
    for (const row of spend) {
      await repo.recordEvent({
        messageId: row.messageId,
        sessionId: row.sessionId,
        userId,
        modelId: 'test/one-model',
        agentId: row.agentId,
        totalTokens: row.totalTokens,
        costUsd: row.costUsd,
      })
    }
  })

  test('groups spend by the agent that produced it', async () => {
    const stats = await repo.queryStats({ userId, groupBy: 'agent' })
    expect(stats.map((row) => [row.key, row.costUsd, row.messages])).toEqual([
      ['builtin:lead', 3, 1],
      ['builtin:qa', 2, 2],
      // The unattributed auxiliary row keeps its own bucket rather than being dropped: the
      // breakdown has to still add up to the summary total.
      ['unknown', 0.5, 1],
    ])
  })

  test('filters every aggregate down to one agent', async () => {
    const summary = await repo.querySummary({ userId, agent: 'builtin:qa' })
    expect(summary).toMatchObject({ messages: 2, costUsd: 2, totalTokens: 200 })
    const logs = await repo.queryLogs({ userId, agent: 'builtin:qa' })
    expect(logs.rows.map((r) => r.messageId).sort()).toEqual(['m2', 'm3'])
    expect(logs.rows.every((r) => r.agentId === 'builtin:qa')).toBe(true)
  })

  test('names each spending agent by the name its session recorded', async () => {
    const keys = await repo.queryKeys(userId)
    expect(keys.agents).toEqual([
      { id: 'builtin:lead', name: 'lead' },
      { id: 'builtin:qa', name: 'qa' },
    ])
  })

  test('a re-persist of the same message keeps one row and re-attributes it', async () => {
    // The streaming → final write path UPSERTs by message id. The speaker is re-derived on
    // every write, so the last one wins rather than leaving the first attribution frozen.
    await repo.recordEvent({
      messageId: 'm1',
      sessionId: 'qa-session',
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
