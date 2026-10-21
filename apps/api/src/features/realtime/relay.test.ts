import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { __resetCapabilityRevision, capabilityRevision } from '../capabilities/revision'
import { createCoreChangeFeed } from '../changes/core-entities'
import { createProviderConnectionsService } from '../provider-connections/service'
import { createRelay, RELAY_TOPICS } from './relay'

describe('the relay', () => {
  test('every kind with topics pokes them, for the notice’s user', async () => {
    for (const [kind, topics] of Object.entries(RELAY_TOPICS)) {
      if (topics === 'ignore') continue
      const published: Array<[string, string[]]> = []
      const relay = createRelay({
        defaultUserId: 'owner',
        publish: (userId, resources) => void published.push([userId, resources]),
      })
      const handler = (relay.handlers as Record<string, unknown>)[kind] as (c: unknown) => void
      __resetCapabilityRevision(0)
      handler({ entity: kind, op: 'upserted', ref: { userId: 'u1', id: 'x' } })
      handler({ entity: kind, op: 'resync' })
      expect(published).toEqual([
        ['u1', [...topics.resources]],
        ['owner', [...('resync' in topics ? topics.resync : topics.resources)]],
      ])
      expect(capabilityRevision()).toBe('bumpsCapabilities' in topics ? 2 : 0)
    }
  })

  test('every provider connection mutation reaches the clients through the feed', async () => {
    const db = createDatabase()
    await migrateToLatest(db)
    const vault = new Map<string, string>()
    const service = createProviderConnectionsService({
      db,
      credentialVault: {
        set: async (userId, key, value) => void vault.set(`${userId}:${key}`, value),
        resolve: async (userId, key) => vault.get(`${userId}:${key}`) ?? null,
        delete: async (userId, key) => vault.delete(`${userId}:${key}`),
      },
    })
    const published: string[][] = []
    const feed = createCoreChangeFeed(db)
    const relay = createRelay({
      defaultUserId: 'u1',
      publish: (_u, resources) => void published.push(resources),
    })
    await feed.subscribe('relay', relay.handlers, { kind: 'projector' })
    const pokes = async (mutation: () => Promise<unknown>) => {
      published.length = 0
      await mutation()
      await feed.settle()
      return published.length
    }

    let id = ''
    expect(
      await pokes(async () => {
        id = (
          await service.createConnection('u1', {
            providerId: 'openrouter',
            providerName: 'OpenRouter',
            label: 'work',
            authType: 'api-key',
            apiKey: 'sk-1',
          })
        ).id
      }),
    ).toBeGreaterThan(0)
    expect(await pokes(() => service.updateConnection('u1', id, { label: 'home' }))).toBe(1)
    let keyId = ''
    expect(
      await pokes(async () => {
        const connection = await service.addKey('u1', id, { apiKey: 'sk-2' })
        keyId = connection.keys.at(-1)!.id
      }),
    ).toBe(1)
    expect(await pokes(() => service.updateKey('u1', id, keyId, { enabled: false }))).toBe(1)
    expect(await pokes(() => service.removeKey('u1', id, keyId))).toBe(1)
    expect(await pokes(() => service.deleteConnection('u1', id))).toBe(1)
    await feed.close()
  })
})
