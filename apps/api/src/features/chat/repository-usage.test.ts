import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { PersistedMessage } from './contracts'
import { createChatRepository, type SessionRecord } from './repository'
import { routedParticipants, sessionFixture } from '../../testing/session-fixture'
import { DEFAULT_AGENT_PARTICIPANT, USER_PARTICIPANT } from '../../db'

const tempDir = join(process.cwd(), 'tmp', 'chat-repository-usage-tests')
const timestamp = '2026-07-31T00:00:00.000Z'

function session(): SessionRecord {
  return sessionFixture({
    id: 'session-a',
    userId: 'user-a',
    seq: 1,
    title: 'Usage branches',
    agents: routedParticipants({ modelId: '', reasoningEffort: 'low' }),
    createdAt: timestamp,
    updatedAt: timestamp,
    lastMessageAt: timestamp,
    rootSessionId: 'session-a',
  })
}

function message(
  id: string,
  role: PersistedMessage['payload']['role'],
  usage?: PersistedMessage['payload']['usage'],
): PersistedMessage {
  return {
    id,
    sessionId: 'session-a',
    userId: 'user-a',
    payload: {
      id,
      role,
      from: role === 'user' ? USER_PARTICIPANT : DEFAULT_AGENT_PARTICIPANT,
      content: id,
      usage,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

describe('repository active-branch usage projection', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('tracks payload updates and follows branch switches without counting siblings', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    await repo.insertSession(session())
    await repo.insertMessage(message('root', 'user'))
    await repo.insertMessage(
      message('branch-a', 'assistant', {
        inputTokens: 10,
        totalTokens: 10,
        totalCost: 0.1,
        costSource: 'actual',
      }),
    )

    await repo.setSessionLeaf('session-a', 'root')
    await repo.insertMessage(
      message('branch-b', 'assistant', {
        inputTokens: 20,
        outputTokens: 5,
        totalCost: 0.2,
        costSource: 'subscription',
      }),
    )

    expect(await repo.getActiveBranchUsage('user-a', 'session-a')).toEqual({
      turns: 1,
      subscriptionCost: 0.2,
      usage: {
        inputTokens: 20,
        outputTokens: 5,
        totalTokens: 25,
        totalCost: 0.2,
        costSource: 'subscription',
        isSummary: true,
      },
    })

    await repo.updateMessage(
      'user-a',
      'session-a',
      'branch-a',
      {
        usage: {
          inputTokens: 12,
          totalTokens: 12,
          totalCost: 0.12,
          costSource: 'estimated',
        },
      },
      '2026-07-31T00:01:00.000Z',
    )
    await repo.setSessionLeaf('session-a', 'branch-a')
    expect(await repo.getActiveBranchUsage('user-a', 'session-a')).toEqual({
      turns: 1,
      subscriptionCost: 0,
      usage: {
        inputTokens: 12,
        totalTokens: 12,
        totalCost: 0.12,
        costSource: 'estimated',
        isSummary: true,
      },
    })

    // Match listMessages' legacy/dangling-leaf fallback: include the full linear
    // row set rather than returning an empty or arbitrarily selected branch.
    await repo.setSessionLeaf('session-a', 'missing')
    expect(await repo.getActiveBranchUsage('user-a', 'session-a')).toEqual({
      turns: 2,
      subscriptionCost: 0.2,
      usage: {
        inputTokens: 32,
        outputTokens: 5,
        totalTokens: 37,
        totalCost: 0.32,
        costSource: 'estimated',
        isSummary: true,
      },
    })

    await destroyDatabase(db)
  })

  test('owner scope cannot expose another user session usage', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    await repo.insertSession(session())
    await repo.insertMessage(message('assistant', 'assistant', { totalTokens: 99 }))

    expect(await repo.getActiveBranchUsage('user-b', 'session-a')).toEqual({
      turns: 0,
      subscriptionCost: 0,
    })
    await destroyDatabase(db)
  })

  test('rolls back the payload when its covering usage write fails', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    await repo.insertSession(session())
    await repo.insertMessage(message('assistant', 'assistant', { totalTokens: 10 }))
    await sql`
      CREATE TRIGGER reject_usage_projection
      BEFORE UPDATE ON agent_message_usage
      BEGIN
        SELECT RAISE(ABORT, 'projection blocked');
      END
    `.execute(db)

    expect(
      repo.updateMessage(
        'user-a',
        'session-a',
        'assistant',
        { usage: { totalTokens: 99 } },
        '2026-07-31T00:02:00.000Z',
      ),
    ).rejects.toThrow('projection blocked')

    expect((await repo.getMessage('user-a', 'session-a', 'assistant'))?.payload.usage).toEqual({
      totalTokens: 10,
    })
    expect(await repo.getActiveBranchUsage('user-a', 'session-a')).toEqual({
      turns: 1,
      subscriptionCost: 0,
      usage: { totalTokens: 10, isSummary: true },
    })
    await destroyDatabase(db)
  })
})
