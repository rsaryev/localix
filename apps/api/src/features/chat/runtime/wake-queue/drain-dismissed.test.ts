import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { testWork } from '../../../../testing/work-fixture'

import { createDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import { agentParticipant } from '../../../../db/participant'
import { sessionFixture } from '../../../../testing/session-fixture'
import { createProviderConnectionsService } from '../../../provider-connections/service'
import { createChatRepository } from '../../repository'
import {
  createTestCatalogService as createCatalogService,
  createTestRuntimeDeps,
} from '../../test-runtime'
import { createAgentRunner } from '../agent-runner'
import { createHitlRegistry } from '../hitl-registry'
import { createSessionStreamRegistry } from '../session-stream-registry'

const tempDir = join(process.cwd(), 'tmp', 'drain-dismissed-tests')

async function waitUntil(done: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await done()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition not reached')
}

describe('drain — a delivery no participant answers', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('is dismissed without minting a wake row or an empty assistant slot', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    const session = sessionFixture({ id: `s_${randomUUID()}` })
    const { userId, id: sessionId } = session
    await repo.insertSession(session)
    const runner = createAgentRunner({
      db,
      work: testWork(db),
      repo,
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      hitlRegistry: createHitlRegistry(),
      streamRegistry: createSessionStreamRegistry(),
      ...createTestRuntimeDeps(),
    })

    // Addressed to a participant that is not (or no longer) in the conversation.
    await runner.wake({
      userId,
      session,
      content: 'job finished',
      source: 'bg-job',
      to: { participant: agentParticipant('agent:departed') },
    })
    await waitUntil(async () => !(await runner.hasQueuedTurn(sessionId)))

    expect(await repo.listMessages(userId, sessionId)).toEqual([])
  })
})
