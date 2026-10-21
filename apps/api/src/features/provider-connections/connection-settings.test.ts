import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { cleanSettings } from './connection-settings'
import { createProviderConnectionsService } from './service'

const tempDir = join(process.cwd(), 'tmp', 'provider-connection-settings-tests')

/**
 * A cloud connection names where its requests go (a region, a resource, a project) beside its
 * key. Every key carries the same settings, the engine reads them from the credential, and they
 * show in the connection's settings — so a secret is never accepted as one.
 */
describe('provider connection settings', () => {
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

  test('every key carries the settings, a later key inherits them, and a change reaches them all', async () => {
    const service = createProviderConnectionsService({ db, credentialVault })
    const userId = 'cloud-user'
    const created = await service.createConnection(userId, {
      providerId: 'azure',
      providerName: 'Azure',
      label: 'Azure',
      authType: 'api-key',
      apiKey: 'az-1',
      settings: { AZURE_RESOURCE_NAME: '  acme  ', AZURE_EMPTY: ' ' },
    })
    expect(created.settings).toEqual({ AZURE_RESOURCE_NAME: 'acme' })

    const withSecond = await service.addKey(userId, created.id, { apiKey: 'az-2' })
    const read = async (keyId: string) =>
      (await service.credentialStoreFor(userId, created.id, keyId)).read('azure')
    for (const key of withSecond.keys) {
      expect(await read(key.id)).toMatchObject({
        type: 'api-key',
        env: { AZURE_RESOURCE_NAME: 'acme' },
      })
    }

    const moved = await service.updateConnection(userId, created.id, {
      settings: { AZURE_RESOURCE_NAME: 'acme-eu' },
    })
    expect(moved.settings).toEqual({ AZURE_RESOURCE_NAME: 'acme-eu' })
    for (const key of moved.keys) {
      expect(await read(key.id)).toMatchObject({ env: { AZURE_RESOURCE_NAME: 'acme-eu' } })
    }
    // The keys themselves were not touched.
    expect((await read(moved.keys[1]!.id)) as { key: string }).toMatchObject({ key: 'az-2' })
  })

  test('a secret is refused as a setting; it belongs in the key', async () => {
    const service = createProviderConnectionsService({ db, credentialVault })
    await expect(
      service.createConnection('cloud-user-2', {
        providerId: 'amazon-bedrock',
        providerName: 'Amazon Bedrock',
        label: 'Bedrock',
        authType: 'api-key',
        apiKey: 'bk',
        settings: { AWS_SECRET_ACCESS_KEY: 'leak' },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('cleaning connection settings', () => {
  test('a personal access token is a secret too, never a plain-text setting', () => {
    for (const name of ['CLARIFAI_PAT', 'SNOWFLAKE_CORTEX_PAT', 'X_AUTH', 'GITHUB_TOKEN'])
      expect(() => cleanSettings({ [name]: 'secret' })).toThrow('secrets belong in the key')
    expect(cleanSettings({ SNOWFLAKE_ACCOUNT: ' xy12345 ' })).toEqual({
      SNOWFLAKE_ACCOUNT: 'xy12345',
    })
  })

  test("only the settings the provider uses are kept when the catalog's list is given", () => {
    expect(cleanSettings({ AWS_REGION: 'us-east-1' }, ['AWS_REGION'])).toEqual({
      AWS_REGION: 'us-east-1',
    })
    expect(() =>
      cleanSettings({ AWS_REGION: 'us-east-1', AZURE_RESOURCE_NAME: 'acme' }, ['AWS_REGION']),
    ).toThrow('not a setting this provider uses')
  })
})
