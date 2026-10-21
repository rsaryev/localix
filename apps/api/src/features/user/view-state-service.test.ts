import { expect, test } from 'bun:test'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { testWork } from '../../testing/work-fixture'
import { createProviderConnectionsService } from '../provider-connections/service'
import { createTestChatService, createTestCatalogService } from '../chat/test-harness'
import { createViewStateService } from './view-state-service'

test('channels retain drafts with CAS, user isolation and session ownership', async () => {
  const db = createDatabase()
  await migrateToLatest(db)
  const chat = createTestChatService({
    db,
    work: testWork(db),
    catalogService: createTestCatalogService(),
    providerConnectionsService: createProviderConnectionsService({ db }),
  })
  const first = createViewStateService(db, () => '2026-10-11T00:00:00Z')
  const second = createViewStateService(db, () => '2026-10-11T00:00:01Z')
  try {
    const session = await chat.createSession('owner', { title: 'Shared draft' })
    const address = { kind: 'draft' as const, key: session.id }
    const results = await Promise.all([
      first.writeViewState('owner', {
        ...address,
        expectedRevision: 0,
        value: { text: 'Main window' },
      }),
      second.writeViewState('owner', {
        ...address,
        expectedRevision: 0,
        value: { text: 'Draft' },
      }),
    ])
    expect(results.filter((result) => result.accepted)).toHaveLength(1)
    const saved = await second.getViewState('owner', address)
    expect(saved.revision).toBe(1)
    expect(results.find((result) => !result.accepted)?.state).toEqual(saved)
    expect((await first.getViewState('other', address)).value).toBeNull()
    await expect(
      first.writeViewState('other', {
        ...address,
        expectedRevision: 0,
        value: { text: 'Forbidden' },
      }),
    ).rejects.toMatchObject({ status: 404 })
    const surface = { kind: 'surface' as const, key: 'quick-chat' }
    await first.writeViewState('owner', {
      ...surface,
      expectedRevision: 0,
      value: { sessionId: session.id },
    })
    expect((await second.getViewState('owner', surface)).value).toEqual({ sessionId: session.id })
    await expect(
      first.writeViewState('owner', {
        kind: 'draft',
        key: 'missing',
        expectedRevision: 0,
        value: { text: 'Lost' },
      }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      first.writeViewState('owner', {
        ...address,
        expectedRevision: 1,
        value: { text: 'x'.repeat(32001) },
      }),
    ).rejects.toThrow()
  } finally {
    await db.destroy()
  }
})
