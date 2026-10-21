/**
 * Every owner of a client topic announces each of its mutations on the core feed, and the relay
 * turns the notice into the topics the composition-root wrappers used to publish. File-owned
 * capabilities (agents, skills) bump the capability revision instead, which the relay pokes on
 * the `resync` the bump announces.
 */
import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCoreChangeFeed } from '../changes/core-entities'
import { createProjectsService } from '../projects/service'
import { createAesCipher } from '../secrets/cipher'
import { createSecretsService } from '../secrets/service'
import { createSecretsStore } from '../secrets/store'
import { createSystemService } from '../system/service'
import { createUserService } from '../user/service'
import { createRelay, RELAY_TOPICS } from './relay'

describe('owners announce every client topic', () => {
  test('each mutation reaches its topics through the feed', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const feed = createCoreChangeFeed(db)
    const published = new Set<string>()
    const relay = createRelay({
      defaultUserId: 'u1',
      publish: (_u, resources) => resources.forEach((r) => published.add(r)),
    })
    await feed.subscribe('relay', relay.handlers, { kind: 'projector' })
    const topics = async (mutation: () => Promise<unknown>) => {
      published.clear()
      await mutation()
      await feed.settle()
      return [...published].sort()
    }

    const projects = createProjectsService({ db })
    const dir = mkdtempSync(join(tmpdir(), 'relay-owners-'))
    let projectId = ''
    expect(
      await topics(async () => {
        projectId = (await projects.createProject('u1', { name: 'p', workingDir: dir })).id
      }),
    ).toEqual(['capabilities', 'projects', 'sessions'])
    expect(
      await topics(() =>
        projects.updateProject('u1', projectId, { settingsPatch: { modelId: 'm' } }),
      ),
    ).toEqual(['capabilities', 'projects', 'sessions'])
    expect(await topics(() => projects.deleteProject('u1', projectId))).toEqual([
      'capabilities',
      'projects',
      'sessions',
    ])

    const user = createUserService({ db })
    expect(
      await topics(() => user.updateProfile('u1', { uiSettingsPatch: { theme: 'dark' } as never })),
    ).toEqual(['profile'])
    expect(
      await topics(() => user.updateProfile('u1', { agentSettingsPatch: {} as never })),
    ).toEqual(['capabilities', 'profile', 'sessions'])
    expect(
      await topics(() =>
        user.writeViewState('u1', {
          kind: 'surface',
          key: 'k1',
          expectedRevision: 0,
          value: null,
        }),
      ),
    ).toEqual(['view-state'])
    // A rejected write (stale revision) changes nothing and announces nothing.
    expect(
      await topics(() =>
        user.writeViewState('u1', { kind: 'surface', key: 'k1', expectedRevision: 0, value: null }),
      ),
    ).toEqual([])

    const secrets = createSecretsService(
      createSecretsStore({ db, cipher: createAesCipher(Buffer.alloc(32, 7)) }),
    )
    expect(
      await topics(() =>
        secrets.create('u1', { key: 'TOKEN', value: 'v1', type: 'api_key', tags: [] }),
      ),
    ).toEqual(['vault'])
    expect(
      await topics(() => secrets.rotate('u1', 'TOKEN', { value: 'v2', expectedVersion: 1 })),
    ).toEqual(['vault'])
    expect(
      await topics(() =>
        secrets.updateMetadata('u1', 'TOKEN', { expectedVersion: 2, description: 'd' }),
      ),
    ).toEqual(['vault'])
    expect(await topics(() => secrets.remove('u1', 'TOKEN'))).toEqual(['vault'])

    let on = false
    const system = createSystemService({
      db,
      toggles: [
        {
          id: 't',
          title: 'T',
          description: '',
          isAvailable: () => true,
          enable: async () => void (on = true),
          disable: async () => void (on = false),
        },
      ],
    })
    expect(await topics(() => system.setToggle('t', true))).toEqual(['system'])
    expect(on).toBe(true)
    await feed.close()
  })

  test('file-owned capabilities poke on the resync their bump announces', () => {
    expect(RELAY_TOPICS.skill.resources).toEqual(['capabilities'])
    expect(RELAY_TOPICS.agent.resync).toEqual(['capabilities'])
    expect(RELAY_TOPICS.agent.resources).toContain('sessions')
  })
})
