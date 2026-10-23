import { expect, test } from 'bun:test'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createAesCipher, plaintextCipher } from './cipher'
import { createSecretsStore } from './store'
import { VaultPayloadError } from './store-internals'

test('metadata updates preserve the value through a new authenticated version', async () => {
  const db = createDatabase()
  try {
    await migrateToLatest(db)
    const store = createSecretsStore({ db, cipher: createAesCipher(Buffer.alloc(32, 7)) })
    const item = await store.create('u', {
      key: 'TEST_KEY',
      value: 'value-sentinel',
      type: 'secret',
      tags: ['original'],
    })
    const updated = await store.updateMetadata('u', 'TEST_KEY', {
      expectedVersion: 1,
      title: 'Renamed',
      description: 'Updated metadata',
      tags: ['updated'],
    })
    expect(updated).toMatchObject({
      status: 'updated',
      item: { id: item!.id, version: 2, label: 'Renamed', tags: ['updated'] },
    })
    expect(await store.resolve('u', 'TEST_KEY')).toBe('value-sentinel')
    expect(
      await store.updateMetadata('u', 'TEST_KEY', { expectedVersion: 1, title: 'Stale' }),
    ).toEqual({ status: 'conflict', currentVersion: 2 })
    const versions = await db
      .selectFrom('vault_item_versions')
      .select(['version', 'reason'])
      .orderBy('version')
      .execute()
    expect(versions).toEqual([
      { version: 1, reason: 'created' },
      { version: 2, reason: 'metadata_updated' },
    ])
    const audits = await db.selectFrom('vault_audit').selectAll().execute()
    expect(JSON.stringify(audits)).not.toContain('value-sentinel')
    expect(audits.filter((entry) => entry.operation === 'update_metadata')).toHaveLength(1)
  } finally {
    await destroyDatabase(db)
  }
})

test.each(['invalid-json', '{"schema":2,"fields":{}}', '{"schema":1,"fields":null}'])(
  'corrupt payload %s leaves metadata, versions and audit unchanged',
  async (encryptedPayload) => {
    const db = createDatabase()
    try {
      await migrateToLatest(db)
      const store = createSecretsStore({ db, cipher: plaintextCipher })
      const item = await store.create('u', {
        key: 'TEST_KEY',
        value: 'original',
        type: 'secret',
        tags: [],
      })
      await db
        .updateTable('vault_item_versions')
        .set({ encrypted_payload: encryptedPayload })
        .where('item_id', '=', item!.id)
        .execute()
      const before = {
        items: await db.selectFrom('vault_items').selectAll().execute(),
        versions: await db.selectFrom('vault_item_versions').selectAll().execute(),
        audit: await db.selectFrom('vault_audit').selectAll().execute(),
      }
      await expect(
        store.updateMetadata('u', 'TEST_KEY', { expectedVersion: 1, title: 'Should not change' }),
      ).rejects.toBeInstanceOf(VaultPayloadError)
      expect(await db.selectFrom('vault_items').selectAll().execute()).toEqual(before.items)
      expect(await db.selectFrom('vault_item_versions').selectAll().execute()).toEqual(
        before.versions,
      )
      expect(await db.selectFrom('vault_audit').selectAll().execute()).toEqual(before.audit)
    } finally {
      await destroyDatabase(db)
    }
  },
)
