import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { testWork } from '../../../../testing/work-fixture'

import { createDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import { sessionFixture } from '../../../../testing/session-fixture'
import { createProviderConnectionsService } from '../../../provider-connections/service'
import { createChatRepository } from '../../repository'
import {
  createTestCatalogService as createCatalogService,
  createTestRuntimeDeps,
  testChatFeaturePorts,
} from '../../test-harness'
import { createAgentRunner } from '../agent-runner'
import { createHitlRegistry } from '../hitl-registry'
import { createSessionStreamRegistry } from '../session-stream-registry'

const tempDir = join(tmpdir(), `localix-drain-dismissed-tests-${process.pid}`)

async function waitUntil(done: () => Promise<boolean>): Promise<void> {
  // Event-loop turns, not a clock: the drain is a few database round trips away.
  for (let i = 0; i < 5000; i++) {
    if (await done()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error('condition not reached')
}

describe('drain — a delivery to a session without an agent', () => {
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
    const session = sessionFixture({ id: `s_${randomUUID()}`, agent: null })
    const { userId, id: sessionId } = session
    await repo.insertSession(session)
    const runner = createAgentRunner({
      db,
      work: testWork(db),
      ports: testChatFeaturePorts(db),
      repo,
      catalogService: createCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
      hitlRegistry: createHitlRegistry(),
      streamRegistry: createSessionStreamRegistry(),
      ...createTestRuntimeDeps(),
    })

    // The session has no agent to answer it.
    await runner.wake({
      userId,
      session,
      content: 'job finished',
      source: 'bg-job',
    })
    await waitUntil(async () => !(await runner.hasQueuedTurn(sessionId)))

    expect(await repo.listMessages(userId, sessionId)).toEqual([])
  })
})
