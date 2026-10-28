import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createProviderConnectionsService } from './service'

const tempDir = join(tmpdir(), `localix-provider-connection-settings-guard-tests-${process.pid}`)

/**
 * What guards a connection's settings beyond the names `cleanSettings` refuses: a refused change
 * writes nothing, and a secret-like value that is stored anyway (an older build, a hand edit) is
 * neither shown back nor left out of the exposure shield.
 */
describe('provider connection settings guard', () => {
  let db: ReturnType<typeof createDatabase>
  const stored = new Map<string, string>()
  const credentialVault = {
    async set(userId: string, key: string, value: string) {
      stored.set(`${userId}:${key}`, value)
    },
    async resolve(userId: string, key: string) {
      return stored.get(`${userId}:${key}`) ?? null
    },
    async delete(userId: string, key: string) {
      return stored.delete(`${userId}:${key}`)
    },
  }

  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
    db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
  })
  afterAll(async () => {
    await destroyDatabase(db)
    await rm(tempDir, { recursive: true, force: true })
  })

  test('a refused setting leaves the connection unchanged, its label included', async () => {
    const service = createProviderConnectionsService({ db, credentialVault })
    const userId = 'guard-user'
    const created = await service.createConnection(userId, {
      providerId: 'azure',
      providerName: 'Azure',
      label: 'Azure',
      authType: 'api-key',
      apiKey: 'az-1',
      settings: { AZURE_RESOURCE_NAME: 'acme' },
    })

    await expect(
      service.updateConnection(userId, created.id, {
        label: 'Renamed',
        settings: { AZURE_SECRET_TOKEN: 'leak' },
      }),
    ).rejects.toMatchObject({ status: 400 })

    const { connections } = await service.listConnections(userId)
    const after = connections.find((connection) => connection.id === created.id)!
    expect(after.label).toBe('Azure')
    expect(after.settings).toEqual({ AZURE_RESOURCE_NAME: 'acme' })
  })

  test('a stored secret-like setting is never shown back and is registered with the shield', async () => {
    const resolved: string[] = []
    const service = createProviderConnectionsService({
      db,
      credentialVault,
      onCredentialResolved: (_userId, value) => resolved.push(value),
    })
    const userId = 'guard-user-2'
    const created = await service.createConnection(userId, {
      providerId: 'clarifai',
      providerName: 'Clarifai',
      label: 'Clarifai',
      authType: 'api-key',
      apiKey: 'cf-key',
    })
    // What an older build could have stored: the personal access token as a plain setting.
    const vaultKey = [...stored.keys()].find((key) => key.startsWith(`${userId}:`))!
    stored.set(
      vaultKey,
      JSON.stringify({
        type: 'api-key',
        key: 'cf-key',
        env: { CLARIFAI_PAT: 'pat-secret', CLARIFAI_REGION: 'us' },
      }),
    )

    const { connections } = await service.listConnections(userId)
    const dto = connections.find((connection) => connection.id === created.id)!
    expect(dto.settings).toEqual({ CLARIFAI_REGION: 'us' })
    expect(JSON.stringify(dto)).not.toContain('pat-secret')
    expect(resolved).toContain('pat-secret')
    expect(resolved).not.toContain('us')
  })

  test('a name the catalog does not ask the provider for is refused; one it asks for is kept', async () => {
    const service = createProviderConnectionsService({
      db,
      credentialVault,
      settingNamesFor: async (providerId) =>
        providerId === 'amazon-bedrock' ? ['AWS_REGION'] : undefined,
    })
    const create = (settings: Record<string, string>) =>
      service.createConnection('guard-user-3', {
        providerId: 'amazon-bedrock',
        providerName: 'Amazon Bedrock',
        label: 'Bedrock',
        authType: 'api-key',
        apiKey: 'bk',
        settings,
      })
    await expect(create({ AZURE_RESOURCE_NAME: 'acme' })).rejects.toMatchObject({ status: 400 })
    const created = await create({ AWS_REGION: 'eu-west-1' })
    expect(created.settings).toEqual({ AWS_REGION: 'eu-west-1' })
    await expect(
      service.updateConnection('guard-user-3', created.id, { settings: { AWS_PROFILE: 'x' } }),
    ).rejects.toMatchObject({ status: 400 })
    // A provider the catalog does not list is checked for secrets only.
    const other = await service.createConnection('guard-user-3', {
      providerId: 'custom-cloud',
      providerName: 'Custom',
      label: 'Custom',
      authType: 'api-key',
      apiKey: 'ck',
      settings: { CUSTOM_REGION: 'north' },
    })
    expect(other.settings).toEqual({ CUSTOM_REGION: 'north' })
  })
})
