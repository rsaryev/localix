import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createUsageRepository } from './repository'
import { recordTitleGenUsage } from '../chat/runtime/usage-normalize'

const tempDir = join(process.cwd(), 'tmp', 'usage-query-tests')

// Exercises queryStats groupBy:'kind' against a real SQLite ledger — the CASE
// over finish_reason must fold visible turns vs auxiliary calls (title, …) into
// their buckets and re-sum cost per bucket. A `compaction` row is spend recorded
// before the summarizer was removed: it has no bucket of its own any more, and its
// cost must stay in the totals, so it folds into `turn` like any unnamed reason.
describe('usage repository — queryStats groupBy kind', () => {
  let db: any
  let repo: ReturnType<typeof createUsageRepository>
  const userId = 'user_kind'

  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
    db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    repo = createUsageRepository(db)

    const rows = [
      { messageId: 'm1', finishReason: 'end_turn', costUsd: 1 },
      { messageId: 'm2', finishReason: 'tool_use', costUsd: 2 },
      { messageId: 'm3', finishReason: null, costUsd: 0.5 },
      { messageId: 'compaction-s-x', finishReason: 'compaction', costUsd: 0.4 },
      { messageId: 'title-s', finishReason: 'title', costUsd: 0.1 },
    ]
    for (const r of rows) {
      await repo.recordEvent({
        messageId: r.messageId,
        sessionId: 's',
        userId,
        modelId: 'test/model',
        totalTokens: 10,
        costUsd: r.costUsd,
        finishReason: r.finishReason,
      })
    }

    // High-frequency aux calls ACCUMULATE onto one stable-keyed row per (session,
    // kind) — three autocomplete calls fold into a single 'autocomplete-s' row.
    for (const costUsd of [0.02, 0.03, 0.05]) {
      await repo.accumulateEvent({
        messageId: 'autocomplete-s',
        sessionId: 's',
        userId,
        modelId: 'test/model',
        totalTokens: 4,
        costUsd,
        finishReason: 'autocomplete',
      })
    }
    await repo.accumulateEvent({
      messageId: 'inline-completion-s',
      sessionId: 's',
      userId,
      modelId: 'test/model',
      totalTokens: 30,
      costUsd: 0.2,
      finishReason: 'inline-completion',
    })
    // Historical prompt-rewrite spend keeps its own kind bucket after retirement.
    await repo.accumulateEvent({
      messageId: 'improve-s',
      sessionId: 's',
      userId,
      modelId: 'test/model',
      totalTokens: 40,
      costUsd: 0.3,
      finishReason: 'improve',
    })
    for (const [messageId, costSource, costUsd] of [
      ['classify-subscription', 'subscription', 0.7],
      ['classify-actual', 'actual', 0.2],
    ] as const) {
      await repo.recordEvent({
        messageId,
        sessionId: 's',
        userId,
        modelId: 'test/model',
        cacheWriteTokens: 6,
        cacheWrite1hTokens: 4,
        totalTokens: 10,
        costUsd,
        costSource,
        finishReason: 'classify',
      })
    }
  })

  afterAll(async () => {
    await destroyDatabase(db)
    await rm(tempDir, { recursive: true, force: true })
  })

  test('folds finish_reason into turn/title/… buckets and sums cost', async () => {
    const stats = await repo.queryStats({ userId, groupBy: 'kind' })
    const byKey = Object.fromEntries(stats.map((s) => [s.key, s]))

    expect(new Set(Object.keys(byKey))).toEqual(
      new Set(['turn', 'title', 'autocomplete', 'inline-completion', 'improve', 'classify']),
    )
    // end_turn + tool_use + null + the historic compaction row all fold into 'turn'.
    expect(byKey.turn.messages).toBe(4)
    expect(byKey.turn.costUsd).toBeCloseTo(3.9, 6)
    expect(byKey.title.messages).toBe(1)
    expect(byKey.title.costUsd).toBeCloseTo(0.1, 6)
    // Three autocomplete calls accumulated onto ONE row — cost + tokens summed.
    expect(byKey.autocomplete.messages).toBe(1)
    expect(byKey.autocomplete.costUsd).toBeCloseTo(0.1, 6)
    expect(byKey.autocomplete.totalTokens).toBe(12)
    expect(byKey['inline-completion'].messages).toBe(1)
    expect(byKey['inline-completion'].costUsd).toBeCloseTo(0.2, 6)
    expect(byKey.improve.messages).toBe(1)
    expect(byKey.improve.costUsd).toBeCloseTo(0.3, 6)
    expect(byKey.improve.totalTokens).toBe(40)
    expect(byKey.classify.cacheWriteTokens).toBe(12)
    expect(byKey.classify.cacheWrite1hTokens).toBe(8)
    expect(byKey.classify.subscriptionCostUsd).toBeCloseTo(0.7, 6)
    // Ordered by cost desc — 'turn' leads.
    expect(stats[0].key).toBe('turn')
  })

  test('a 175-turn message ledger totals exactly once per assistant message', async () => {
    // Its own user: 175 rows under the shared `userId` leaked into the kind-bucket
    // test's counts (it saw 178 messages instead of 3) whenever this ran first.
    const ledgerUser = 'user_ledger'
    for (let index = 0; index < 175; index += 1) {
      await repo.recordEvent({
        messageId: `long-${index}`,
        sessionId: 'long-session',
        userId: ledgerUser,
        modelId: 'test/model',
        inputTokens: 7,
        outputTokens: 3,
        cacheReadTokens: 2,
        cacheWriteTokens: 1,
        cacheWrite1hTokens: 1,
        totalTokens: 10,
        costUsd: 0.001,
        finishReason: 'end_turn',
      })
    }
    // Streaming/final persistence replaces the same message row, never doubles it.
    await repo.recordEvent({
      messageId: 'long-174',
      sessionId: 'long-session',
      userId: ledgerUser,
      modelId: 'test/model',
      inputTokens: 9,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      cacheWrite1hTokens: 2,
      totalTokens: 14,
      costUsd: 0.002,
      finishReason: 'end_turn',
    })
    const total = await repo.querySummary({ userId: ledgerUser, session: 'long-session' })
    expect(total).toMatchObject({
      messages: 175,
      inputTokens: 1_227,
      outputTokens: 527,
      cacheReadTokens: 351,
      cacheWriteTokens: 176,
      cacheWrite1hTokens: 176,
      totalTokens: 1_754,
    })
    expect(total.costUsd).toBeCloseTo(0.176, 9)
  })

  test('repeated title calls keep every billed token while one routing identity stays one row', async () => {
    // Its own user for the same reason as the ledger test above: these title rows are
    // counted by the kind-bucket test, which filters by user but not by session.
    const titleUser = 'user_title_retry'
    for (const usage of [
      { inputTokens: 8, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 1 },
      { inputTokens: 10, outputTokens: 3, cacheReadTokens: 4, cacheWriteTokens: 2 },
    ]) {
      recordTitleGenUsage({
        usageRepo: repo,
        userId: titleUser,
        sessionId: 'title-retry-session',
        modelId: 'test/title-model',
        providerConnectionId: 'title-oauth',
        usage,
      })
    }
    await new Promise((resolve) => setTimeout(resolve, 0))

    const total = await repo.querySummary({ userId: titleUser, session: 'title-retry-session' })
    expect(total).toMatchObject({
      messages: 1,
      inputTokens: 18,
      outputTokens: 5,
      cacheReadTokens: 7,
      cacheWriteTokens: 3,
      totalTokens: 23,
    })
    const kind = await repo.queryStats({
      userId: titleUser,
      session: 'title-retry-session',
      groupBy: 'kind',
    })
    expect(kind).toEqual([expect.objectContaining({ key: 'title', totalTokens: 23 })])
  })
})
