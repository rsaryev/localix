import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { tempDirPerTest } from '@localixai/testing'

import { createChatFeaturePorts } from '../../../../bootstrap/chat-feature-ports'
import { createDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import { sessionFixture } from '../../../../testing/session-fixture'
import { testWork } from '../../../../testing/work-fixture'
import { createProviderConnectionsService } from '../../../provider-connections/service'
import { createChatRepository } from '../../repository'
import { createTestCatalogService, createTestRuntimeDeps } from '../../test-harness'
import { createAgentRunner } from '../agent-runner'
import { createHitlRegistry } from '../hitl-registry'
import { createSessionStreamRegistry } from '../session-stream-registry'

const scratch = tempDirPerTest('solo-chat-tags-')

async function waitUntil(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 5000; i++) {
    if (await done()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('condition not reached')
}

describe('a conversation has one agent, fixed at creation', () => {
  test('tagging a directory agent in a message answers with the chat’s own agent and adds nobody', async () => {
    const db = createDatabase({ filename: `${scratch()}/${randomUUID()}.sqlite` })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    const session = sessionFixture({ id: `s_${randomUUID()}` })
    const { userId, id: sessionId } = session
    await repo.insertSession(session)
    const runner = createAgentRunner({
      db,
      work: testWork(db),
      ports: createChatFeaturePorts(db),
      repo,
      catalogService: createTestCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      hitlRegistry: createHitlRegistry(),
      streamRegistry: createSessionStreamRegistry(),
      ...createTestRuntimeDeps(),
    } as never)

    await runner.wake({ userId, session, content: '@qa please check', internal: false })
    await waitUntil(async () => !(await runner.hasQueuedTurn(sessionId)))

    const stored = await repo.getSession(userId, sessionId)
    expect(stored?.agent?.name).toBe(session.agent!.name)
    const authors = (await repo.listMessages(userId, sessionId))
      .filter((message) => message.payload.role === 'assistant')
      .map((message) => message.payload.from)
    expect(authors.every((from) => from === `agent:${session.agent!.agentId}`)).toBe(true)
    await db.destroy()
  })
})
