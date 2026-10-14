import { expect, test } from 'bun:test'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createTestChatService, createTestCatalogService } from '../chat/test-runtime'
import { createProviderConnectionsService } from '../provider-connections/service'
import { testWork } from '../../testing/work-fixture'
import type { AgentStreamEvent } from '../chat/contracts'

test('two independent workspaces share committed creation, metadata and subtree deletion; another user is isolated', async () => {
  const db = createDatabase()
  await migrateToLatest(db)
  const service = createTestChatService({
    db,
    work: testWork(db),
    catalogService: createTestCatalogService(),
    providerConnectionsService: createProviderConnectionsService({ db }),
  })
  const windows: AgentStreamEvent[][] = [[], [], []]
  const stops = windows.map((events, n) =>
    service.streamRegistry.subscribeScoped(
      n === 2 ? 'other' : 'owner',
      (frame) => {
        events.push(frame.event)
      },
      { watching: new Set() },
    ),
  )
  try {
    const root = await service.createSession('owner', { title: 'Shared' })
    const child = await service.createSession('owner', {
      title: 'Thread',
      parentSessionId: root.id,
    })
    await service.updateSession('owner', root.id, { title: 'Renamed', isArchived: true })
    await service.deleteSession('owner', root.id)
    expect(windows[0]).toEqual(windows[1])
    expect(windows[2]).toEqual([])
    const events = windows[0]!
    expect(
      events.some(
        (event) =>
          event.type === 'session.updated' &&
          event.session.id === root.id &&
          event.session.title === 'Shared',
      ),
    ).toBe(true)
    expect(
      events.some(
        (event) => event.type === 'child_session.updated' && event.session.id === child.id,
      ),
    ).toBe(true)
    expect(
      events.some(
        (event) =>
          event.type === 'session.updated' &&
          event.session.title === 'Renamed' &&
          event.session.isArchived,
      ),
    ).toBe(true)
    const deletion = events.find((event) => event.type === 'session.deleted')
    expect(deletion?.type === 'session.deleted' ? new Set(deletion.sessionIds) : null).toEqual(
      new Set([root.id, child.id]),
    )
    expect((await service.listSessions('owner')).sessions).toEqual([])
  } finally {
    stops.forEach((stop) => stop())
    await destroyDatabase(db)
  }
})
