import { expect, test } from 'bun:test'
import { createDatabase, destroyDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createProviderConnectionsService } from '../../provider-connections/service'
import { createProjectsRepository } from '../../projects/repository'
import { createTestCatalogService, createTestChatService } from '../test-runtime'
import { testWork } from '../../../testing/work-fixture'

test('an attached native identity is persisted at chat creation without imported messages', async () => {
  const db = createDatabase()
  try {
    await migrateToLatest(db)
    await createProjectsRepository(db).insertProject({
      id: 'project',
      userId: 'user',
      name: 'Project',
      workingDir: '/work/project',
      settings: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    })
    const service = createTestChatService({
      db,
      work: testWork(db),
      catalogService: createTestCatalogService(),
      providerConnectionsService: createProviderConnectionsService({ db }),
    })
    const chat = await service.createSession('user', {
      projectId: 'project',
      title: 'Existing CLI review',
      externalAgentProvider: 'codex',
      externalAgentSessionKey: 'codex:native',
    })
    expect(chat.messages).toEqual([])
    expect(chat).toMatchObject({
      projectId: 'project',
      externalAgentProvider: 'codex',
      externalAgentSessionKey: 'codex:native',
    })
    expect(
      (await service.listSessions('user')).sessions.find((session) => session.id === chat.id),
    ).toMatchObject({
      externalAgentProvider: 'codex',
      externalAgentSessionKey: 'codex:native',
    })
    expect((await service.listSessions('other-user')).sessions).toEqual([])
    const ordinary = await service.createSession('user', {
      projectId: 'project',
      title: 'Existing ordinary chat',
    })
    const linked = await service.updateSession('user', ordinary.id, {
      externalAgentProvider: 'codex',
    })
    expect(linked).toMatchObject({
      id: ordinary.id,
      projectId: 'project',
      title: ordinary.title,
      externalAgentProvider: 'codex',
      messages: [],
    })
    expect(
      (await service.listSessions('user')).sessions.find((session) => session.id === ordinary.id)
        ?.externalAgentProvider,
    ).toBe('codex')
    await expect(
      service.updateSession('user', ordinary.id, { externalAgentProvider: 'claude-code' }),
    ).rejects.toThrow('already has a linked agent')
  } finally {
    await destroyDatabase(db)
  }
})
