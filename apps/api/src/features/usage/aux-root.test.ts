import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createChatRepository } from '../chat/repository'
import { recordAuxCallUsage, recordTitleGenUsage } from '../chat/runtime/usage-normalize'
import { sessionFixture } from '../../testing/session-fixture'
import { createUsageRepository } from './repository'

/**
 * An auxiliary call's spend belongs to the session's REAL tree. Title generation and the aux
 * calls stamped `rootSessionId = sessionId`, so a delegated child's titling and completion spend
 * was filed as a tree of its own and the root's `sessionTree` total never saw it.
 */
describe('auxiliary usage is filed under the session’s real root', () => {
  let db: ReturnType<typeof createDatabase>
  let repo: ReturnType<typeof createUsageRepository>
  const dir = join(process.cwd(), 'tmp', 'usage-aux-root-tests')
  const userId = 'u-aux-root'

  beforeAll(async () => {
    await mkdir(dir, { recursive: true })
    db = createDatabase({ filename: join(dir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    repo = createUsageRepository(db)
    const chats = createChatRepository(db)
    await chats.insertSession(sessionFixture({ id: 'root', userId, seq: 1, rootSessionId: 'root' }))
    await chats.insertSession(
      sessionFixture({
        id: 'child',
        userId,
        seq: 2,
        parentSessionId: 'root',
        rootSessionId: 'root',
        sessionKind: 'subagent',
      }),
    )
  })

  afterAll(async () => {
    await destroyDatabase(db)
    await rm(dir, { recursive: true, force: true })
  })

  const rootOf = async (messageIdPrefix: string) => {
    const rows = await db
      .selectFrom('usage_events')
      .select(['root_session_id'])
      .where('message_id', 'like', `${messageIdPrefix}%`)
      .execute()
    return rows.map((row) => row.root_session_id)
  }

  test("a child's title and aux spend count toward its root's tree", async () => {
    const usage = { inputTokens: 10, outputTokens: 5 }
    const base = { usageRepo: repo, userId, sessionId: 'child', modelId: 'test/model', usage }
    recordTitleGenUsage(base)
    recordAuxCallUsage({ ...base, kind: 'improve' })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(await rootOf('aux-title:')).toEqual(['root'])
    expect(await rootOf('aux-improve:')).toEqual(['root'])
    const tree = await repo.queryStats({ userId, sessionTree: 'root', groupBy: 'kind' })
    expect(tree.find((row) => row.key === 'title')?.inputTokens).toBe(10)
  })
})
